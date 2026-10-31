// pnpm --filter @guardbee/mcp-bench bench [-- --split dev|test]
// Third-party baselines: mcp-guardian (devDependency) and, with MCP_BENCH_CISCO=<path to mcp-scanner>,
// Cisco MCP Scanner's YARA mode. The LLM judge runs with GUARDBEE_JUDGE_URL and GUARDBEE_JUDGE_MODEL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, TASKS, type SystemScore } from "./evaluate.js";
import type { Split } from "./data.js";
import { allSystems } from "./systems.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const split = (process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "test") as Split;
const resultsDir = path.join(here, "..", "results");
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const range = (i: { low: number; high: number }) => `${pct(i.low)}–${pct(i.high)}`;

const TITLES: Record<string, string> = {
  tools: "Tool definitions: poisoned vs benign",
  results: "Tool results: indirect injection vs benign",
  flows: "Tool catalogs: toxic flow (lethal trifecta) vs safe",
  rugpulls: "Rug pulls: malicious vs benign definition changes",
};

const scores: SystemScore[] = [];
for (const system of await allSystems()) {
  process.stderr.write(`${system.name}…\n`);
  scores.push(await evaluate(system, split));
}

fs.mkdirSync(resultsDir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(resultsDir, `leaderboard.${split}.json`), JSON.stringify({ date, split, scores }, null, 2) + "\n");

const lines = [`# MCP Security Benchmark — ${split} split`, "", `${date}. Precision, recall and F1 with bootstrap 95% intervals (1000 resamples, positives and negatives resampled separately). Latency is the mean per item on the machine that ran it. See [README](../README.md) for the data, the settings and the limitations.`, ""];
for (const task of TASKS) {
  const rows = scores.flatMap((s) => s.tasks.filter((t) => t.task === task).map((t) => ({ s, t })));
  if (!rows.length) continue;
  lines.push(`## ${TITLES[task]} (n=${rows[0]!.t.n})`, "", "| System | Version | Precision | Recall | F1 | False-positive rate | ms/item |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const { s, t } of rows.sort((a, b) => b.t.metrics.f1 - a.t.metrics.f1)) {
    lines.push(`| ${s.system} | ${s.version} | ${pct(t.metrics.precision)} (${range(t.intervals.precision)}) | ${pct(t.metrics.recall)} (${range(t.intervals.recall)}) | ${t.metrics.f1.toFixed(2)} (${range(t.intervals.f1).replace(/%/g, "")}) | ${pct(t.metrics.fpr)} | ${t.latencyMs < 1 ? "<1" : t.latencyMs.toFixed(0)} |`);
  }
  lines.push("");
}
lines.push("## Settings", "", ...scores.map((s) => `- **${s.system}** (${s.version}): ${s.settings}`), "");
fs.writeFileSync(path.join(resultsDir, `LEADERBOARD.${split}.md`), lines.join("\n"));
process.stdout.write(lines.join("\n") + "\n");
