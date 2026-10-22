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

/** Package versions without a release yet. */
const pending = [];
for (const dir of readdirSync(packagesDir).sort()) {
  const manifestPath = join(packagesDir, dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  const { name, version, private: isPrivate } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (isPrivate) continue;
  const tag = `${name}@${version}`;
  if (succeeds("gh", ["release", "view", tag])) continue;
  pending.push({ dir, name, version, tag });
}

// npm's metadata lags a fresh publish by up to a minute or two: a version the run
// just published can read as missing. Check again before skipping it.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const created = [];
let waiting = pending;
for (let attempt = 0; attempt < 5 && waiting.length > 0; attempt++) {
  if (attempt > 0) await sleep(30_000);
  const notYet = [];
  for (const entry of waiting) {
    if (!succeeds("npm", ["view", entry.tag, "version"])) {
      notYet.push(entry);
      continue;
    }
    const changelogPath = join(packagesDir, entry.dir, "CHANGELOG.md");
    const notes = (existsSync(changelogPath) && notesFor(readFileSync(changelogPath, "utf8"), entry.version)) || `Published to npm: https://www.npmjs.com/package/${entry.name}/v/${entry.version}`;
    run("gh", ["release", "create", entry.tag, "--target", target, "--title", entry.tag, "--notes-file", "-", `--latest=${entry.name === LATEST}`], notes);
    created.push(entry.tag);
  }
  waiting = notYet;
}
console.log(created.length ? `created releases: ${created.join(", ")}` : "no new releases");
if (waiting.length) console.log(`not on npm yet, left for the next run: ${waiting.map((e) => e.tag).join(", ")}`);
