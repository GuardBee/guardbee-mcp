#!/usr/bin/env node
// A git tag and a GitHub release for every published package version that has
// none yet. The notes are that version's section of the package CHANGELOG.md.
// Safe to run on every push: versions with a release, or not on npm yet, are skipped.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const target = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
// The proxy is the flagship: its release is the one GitHub shows as "Latest"
const LATEST = "@guardbee/mcp-security-proxy";

const run = (cmd, args, input) => execFileSync(cmd, args, { encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], input });
const succeeds = (cmd, args) => {
  try {
    run(cmd, args);
    return true;
  } catch {
    return false;
  }
};

/** The `## <version>` section of a Changesets CHANGELOG, without its heading. */
function notesFor(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

const created = [];
for (const dir of readdirSync(packagesDir).sort()) {
  const manifestPath = join(packagesDir, dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  const { name, version, private: isPrivate } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (isPrivate) continue;
  const tag = `${name}@${version}`;
  if (succeeds("gh", ["release", "view", tag])) continue;
  if (!succeeds("npm", ["view", tag, "version"])) continue;
  const changelogPath = join(packagesDir, dir, "CHANGELOG.md");
  const notes = (existsSync(changelogPath) && notesFor(readFileSync(changelogPath, "utf8"), version)) || `Published to npm: https://www.npmjs.com/package/${name}/v/${version}`;
  run("gh", ["release", "create", tag, "--target", target, "--title", tag, "--notes-file", "-", `--latest=${name === LATEST}`], notes);
  created.push(tag);
}
console.log(created.length ? `created releases: ${created.join(", ")}` : "no new releases");
