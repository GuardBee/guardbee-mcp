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
// for. Needs `mcp-publisher` on PATH; logs in with GitHub OIDC on first use
// unless MCP_PUBLISHER_LOGGED_IN is set.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const REGISTRY = "https://registry.modelcontextprotocol.io";
const WAIT_MS = 15_000;
const ATTEMPTS = 24; // 6 minutes for a version tagged at HEAD

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(cmd, args, cwd = root) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

async function inRegistry(name, version) {
  const res = await fetch(`${REGISTRY}/v0/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`registry lookup ${name}@${version}: HTTP ${res.status}`);
}

/** The npm tarball's mcpName, or null when npm does not serve that version (yet). */
function npmMcpName(pkg, version) {
  const result = run("npm", ["view", `${pkg}@${version}`, "mcpName", "--json"]);
  if (!result.ok) return null;
  const text = result.out.trim();
  return text ? JSON.parse(text) : "";
}

const justTagged = new Set(run("git", ["tag", "--points-at", "HEAD"]).out.split("\n").filter(Boolean));

const pending = [];
for (const dir of readdirSync(packagesDir).sort()) {
  const serverPath = join(packagesDir, dir, "server.json");
  if (!existsSync(serverPath)) continue;
  const pkg = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
  const server = JSON.parse(readFileSync(serverPath, "utf8"));
  if (await inRegistry(server.name, server.version)) continue;
  pending.push({ dir: join(packagesDir, dir), pkg: pkg.name, server, fresh: justTagged.has(`${pkg.name}@${server.version}`) });
}

let loggedIn = Boolean(process.env.MCP_PUBLISHER_LOGGED_IN);
const failed = [];
for (const { dir, pkg, server, fresh } of pending) {
  const label = `${server.name}@${server.version}`;
  let done = false;
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
    const mcpName = npmMcpName(pkg, server.version);
    if (mcpName === null) {
      if (!fresh) {
        console.log(`skip ${label}: ${pkg}@${server.version} is not on npm`);
        done = true;
        break;
      }
      last = "not on npm yet";
    } else if (mcpName !== server.name) {
      console.log(`skip ${label}: the npm tarball says mcpName "${mcpName}"; it moves on the next release`);
      done = true;
      break;
    } else {
      if (!loggedIn) {
        const login = run("mcp-publisher", ["login", "github-oidc"]);
        if (!login.ok) throw new Error(`mcp-publisher login github-oidc failed:\n${login.out}`);
        loggedIn = true;
      }
      const result = run("mcp-publisher", ["publish"], dir);
      last = result.out.trim();
      if (result.ok || /already exists|duplicate version|cannot publish duplicate/i.test(last)) {
        console.log(`registry: ${label} published`);
        done = true;
        break;
      }
      // The registry reads npm itself and can lag behind what `npm view` sees.
      if (!/not found|404/i.test(last)) break;
    }
    if (attempt < ATTEMPTS) await sleep(WAIT_MS);
  }
  if (!done) failed.push(`${label}: ${last.split("\n").slice(-3).join(" ")}`);
}

if (pending.length === 0) console.log("MCP Registry is up to date");
if (failed.length > 0) {
  console.error(`MCP Registry publish failed:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
