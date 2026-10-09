#!/usr/bin/env node
// Keep each package's server.json (MCP Registry entry) in step with its
// package.json: the registry name is `mcpName`, and the server and npm package
// versions are the package version. Runs after `changeset version`, so the
// Version Packages PR carries the bumps instead of a manual follow-up.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const check = process.argv.includes("--check");
const stale = [];

for (const dir of readdirSync(packagesDir)) {
  const serverPath = join(packagesDir, dir, "server.json");
  if (!existsSync(serverPath)) continue;
  const pkg = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
  const raw = readFileSync(serverPath, "utf8");
  const server = JSON.parse(raw);

  if (pkg.mcpName) server.name = pkg.mcpName;
  server.version = pkg.version;
  for (const entry of server.packages ?? []) {
    if (entry.registryType === "npm" && entry.identifier === pkg.name) entry.version = pkg.version;
  }

  const next = `${JSON.stringify(server, null, 2)}\n`;
  if (next === raw) continue;
  stale.push(dir);
  if (!check) writeFileSync(serverPath, next);
}

if (check && stale.length > 0) {
  console.error(`server.json out of step with package.json: ${stale.join(", ")}\nRun: node scripts/sync-server-json.mjs`);
  process.exit(1);
}
if (!check && stale.length > 0) console.log(`synced server.json: ${stale.join(", ")}`);
