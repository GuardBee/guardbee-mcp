import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { scanAgentHistory } from "../agent-history.js";
import { scanDirectory, scanFile } from "../scanner.js";

// Assembled at runtime so the repo's own secret scan does not flag this file
const GH = ["ghp", "u8jzPde0IgxLd6GncfBAepfJBd0Kh8oOOL8d"].join("_");
const NPM = ["npm", "Xq7Lm2vZc9RkB4nW1yZp6sDf3hJ8gKa5eUoT"].join("_");

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake home folder with agent transcripts. */
function home(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gb-agent-home-"));
  homes.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const line = (text: string) => `${JSON.stringify({ type: "user", message: { content: text } })}\n`;

describe("agent history", () => {
  it("finds a secret pasted into Claude Code and Codex sessions, once per agent with its count", () => {
    const h = home({
      ".claude/projects/-Users-me-app/s1.jsonl": line("hi") + line(`here is my token ${GH}`),
      ".claude/projects/-Users-me-app/s2.jsonl": line(`again: ${GH}`),
      ".codex/sessions/2026/10/09/rollout.jsonl": line(`npm token ${NPM}`),
    });
    const result = scanAgentHistory({ home: h });
    expect(result.sources.map((s) => `${s.agent}:${s.files}`)).toEqual(["claude-code:2", "codex:1"]);
    const claude = result.findings.find((f) => f.agent === "claude-code")!;
    expect(claude).toMatchObject({ patternId: "github_pat", occurrences: 2, line: 2 });
    expect(result.findings.find((f) => f.agent === "codex")).toMatchObject({ patternId: "npm_token", occurrences: 1 });
    expect(JSON.stringify(result)).not.toContain(GH);
  });

  it("reads transcripts larger than the 1 MB file limit, line by line", () => {
    const filler = line("x".repeat(500)).repeat(2500); // ~1.3 MB
    const h = home({ ".claude/projects/p/big.jsonl": filler + line(`token ${GH}`) });
    const [finding] = scanAgentHistory({ home: h }).findings;
    expect(finding).toMatchObject({ patternId: "github_pat", line: 2501 });
  });

  it("leaves the entropy check off unless asked: transcripts are full of code", () => {
    const value = ["Q7tLm2vXc9RkB4nW1yZp", "6sDf3hJ8gKa5eUoT"].join("");
    const h = home({ ".claude/projects/p/s.jsonl": line(`AUTH_TOKEN=${value}`) });
    expect(scanAgentHistory({ home: h }).findings).toEqual([]);
    expect(scanAgentHistory({ home: h, entropy: true }).findings.map((f) => f.patternId)).toEqual(["high_entropy_secret"]);
  });

  it("finds nothing, without failing, when no agent has history", () => {
    expect(scanAgentHistory({ home: home({}) })).toMatchObject({ sources: [], totalFindings: 0 });
  });
});

describe("large line files in ordinary scans", () => {
  it("streams .ipynb, .jsonl and .log past 1 MB, but still skips other large files", () => {
    const big = "a".repeat(1_100_000);
    const h = home({
      "nb.ipynb": `{"cells": [\n"${big}",\n"key = '${GH}'"\n]}\n`,
      "data.json": `{"blob": "${big}", "k": "${GH}"}`,
    });
    expect(scanFile(join(h, "nb.ipynb")).findings).toEqual([expect.objectContaining({ patternId: "github_pat", line: 3 })]);
    expect(scanFile(join(h, "data.json")).skipped).toBe(true);
    expect(scanDirectory(h).findings.map((f) => f.file?.endsWith("nb.ipynb"))).toEqual([true]);
  });
});

describe("CLI --agent-history", () => {
  const cli = resolve(__dirname, "../../dist/cli.js");
  it("fails on a finding and tells you to rotate it", () => {
    const h = home({ ".claude/projects/p/s.jsonl": line(`token ${GH}`) + line(`token ${GH}`) });
    const run = spawnSync("node", [cli, "scan", "--agent-history", `--home=${h}`], { encoding: "utf8", env: { ...process.env, GUARDBEE_TELEMETRY: "0" } });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("already sent to the model provider");
    expect(run.stdout).toContain("appears 2 times");
    expect(run.stdout).not.toContain(GH);
  }, 30_000);
});
