#!/usr/bin/env node
// Publish the packages changesets just put on npm to the official MCP Registry.
// Input: PUBLISHED_PACKAGES, the changesets/action `publishedPackages` output
// ([{ name, version }]). Needs `mcp-publisher` on PATH, already logged in.
//
// The registry checks the npm tarball (its `mcpName` must match server.json),
// and a fresh npm version can take minutes to become readable, so each package
// waits for npm first and retries "not found" answers from the registry.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const published = JSON.parse(process.env.PUBLISHED_PACKAGES || "[]");
const WAIT_MS = 15_000;
const ATTEMPTS = 24; // 6 minutes

const dirByName = new Map();
for (const dir of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  dirByName.set(JSON.parse(readFileSync(pkgPath, "utf8")).name, join(packagesDir, dir));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(cmd, args, cwd) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const failed = [];
for (const { name, version } of published) {
  const dir = dirByName.get(name);
  if (!dir || !existsSync(join(dir, "server.json"))) continue;
  const server = JSON.parse(readFileSync(join(dir, "server.json"), "utf8"));
  if (server.version !== version) {
    failed.push(`${name}@${version}: server.json says ${server.version} (run scripts/sync-server-json.mjs)`);
    continue;
  }

  let done = false;
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
    const onNpm = run("npm", ["view", `${name}@${version}`, "version"], dir);
    if (!onNpm.ok || onNpm.out.trim() !== version) {
      last = "not on npm yet";
    } else {
      const result = run("mcp-publisher", ["publish"], dir);
      last = result.out.trim();
      if (result.ok) {
        console.log(`registry: ${server.name}@${version} published`);
        done = true;
        break;
      }
      // Already there (a re-run after a partial failure) counts as done.
      if (/already exists|duplicate version|cannot publish duplicate/i.test(last)) {
        console.log(`registry: ${server.name}@${version} already published`);
        done = true;
        break;
      }
      if (!/not found|404/i.test(last)) break;
    }
    if (attempt < ATTEMPTS) await sleep(WAIT_MS);
  }
  if (!done) failed.push(`${name}@${version}: ${last.split("\n").slice(-3).join(" ")}`);
}

if (failed.length > 0) {
  console.error(`MCP Registry publish failed:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
