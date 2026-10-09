#!/usr/bin/env node
// Bring the official MCP Registry up to npm. For every package with a
// server.json, publish `name@version` when the registry lacks it, npm has that
// version, and the npm tarball's `mcpName` is the server.json name (the
// registry checks this; a package whose last npm release predates its current
// mcpName is left until its next release).
//
// It works from state rather than from what changesets says it published, so a
// skipped or failed run is caught up by the next one. Versions tagged at HEAD
// were just published: npm may take minutes to serve them, so those are waited
// for — all at once, so several slow packages cost one wait, not one each.
// Needs `mcp-publisher` on PATH; logs in with GitHub OIDC on first use unless
// MCP_PUBLISHER_LOGGED_IN is set.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const REGISTRY = "https://registry.modelcontextprotocol.io";
const WAIT_MS = 15_000;
const ATTEMPTS = 40; // 10 minutes for a version tagged at HEAD

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const execFileAsync = promisify(execFile);

async function run(cmd, args, cwd = root) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, out: stdout };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** true / false, or an error string when the registry keeps failing (a 5xx must not stop every other package). */
async function inRegistry(name, version) {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${REGISTRY}/v0/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await sleep(2_000 * attempt);
  }
  return `registry lookup ${name}@${version} failed: ${last}`;
}

/** The npm tarball's mcpName, or null when npm does not serve that version (yet). */
async function npmMcpName(pkg, version) {
  const result = await run("npm", ["view", `${pkg}@${version}`, "mcpName", "--json"]);
  if (!result.ok) return null;
  const text = result.out.trim();
  return text ? JSON.parse(text) : "";
}

const justTagged = new Set((await run("git", ["tag", "--points-at", "HEAD"])).out.split("\n").filter(Boolean));

const pending = [];
const lookupErrors = [];
for (const dir of readdirSync(packagesDir).sort()) {
  const serverPath = join(packagesDir, dir, "server.json");
  if (!existsSync(serverPath)) continue;
  const pkg = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
  const server = JSON.parse(readFileSync(serverPath, "utf8"));
  const listed = await inRegistry(server.name, server.version);
  if (listed === true) continue;
  if (typeof listed === "string") {
    lookupErrors.push(listed);
    continue;
  }
  pending.push({ dir: join(packagesDir, dir), pkg: pkg.name, server, fresh: justTagged.has(`${pkg.name}@${server.version}`) });
}

// One login for every package, started by whichever needs it first
let login = process.env.MCP_PUBLISHER_LOGGED_IN ? Promise.resolve() : null;
const ensureLogin = () =>
  (login ??= run("mcp-publisher", ["login", "github-oidc"]).then((result) => {
    if (!result.ok) throw new Error(`mcp-publisher login github-oidc failed:\n${result.out}`);
  }));

/** Returns null when done (published or skipped), else why it failed. */
async function publishOne({ dir, pkg, server, fresh }) {
  const label = `${server.name}@${server.version}`;
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const mcpName = await npmMcpName(pkg, server.version);
    if (mcpName === null) {
      if (!fresh) {
        console.log(`skip ${label}: ${pkg}@${server.version} is not on npm`);
        return null;
      }
      last = "not on npm yet";
    } else if (mcpName !== server.name) {
      console.log(`skip ${label}: the npm tarball says mcpName "${mcpName}"; it moves on the next release`);
      return null;
    } else {
      await ensureLogin();
      const result = await run("mcp-publisher", ["publish"], dir);
      last = result.out.trim();
      if (result.ok || /already exists|duplicate version|cannot publish duplicate/i.test(last)) {
        console.log(`registry: ${label} published`);
        return null;
      }
      // The registry reads npm itself and can lag behind what `npm view` sees.
      if (!/not found|404/i.test(last)) break;
    }
    if (attempt < ATTEMPTS) await sleep(WAIT_MS);
  }
  return `${label}: ${last.split("\n").slice(-3).join(" ")}`;
}

const failed = [...lookupErrors, ...(await Promise.all(pending.map(publishOne))).filter((reason) => reason !== null)];

if (pending.length === 0 && lookupErrors.length === 0) console.log("MCP Registry is up to date");
if (failed.length > 0) {
  console.error(`MCP Registry publish failed:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
