// pnpm --filter @guardbee/injection-bench bench [-- --split dev|test]
// Optional: INJECTION_BENCH_PROTECTAI=<dir with model.onnx + tokenizer.json> for the ProtectAI baseline,
// GUARDBEE_JUDGE_URL + GUARDBEE_JUDGE_MODEL for the local LLM judge.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSamples, type Split } from "./data.js";
import { evaluate, type SystemScore } from "./evaluate.js";
import { allSystems } from "./systems.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const split = (process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "test") as Split;
const samples = loadSamples({ split });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const range = (i: { low: number; high: number }) => `${(i.low * 100).toFixed(1)}–${(i.high * 100).toFixed(1)}`;

const results: SystemScore[] = [];
for (const system of await allSystems()) {
  process.stderr.write(`${system.name}…\n`);
  results.push(await evaluate(system, samples));
  await system.close?.();
}

const dir = path.join(here, "..", "results");
fs.mkdirSync(dir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(dir, `leaderboard.${split}.json`), JSON.stringify({ date, split, results }, null, 2) + "\n");

const count = (lang: string, label: string) => samples.filter((s) => s.lang === lang && s.label === label).length;
const lines = [
  `# Prompt-Injection Benchmark (Turkish + English) — ${split} split`,
  "",
  `${date}. ${samples.length} samples: English ${count("en", "attack")} attacks / ${count("en", "benign")} benign, Turkish ${count("tr", "attack")} / ${count("tr", "benign")}. Bootstrap 95% intervals (1000 resamples, attacks and benign resampled separately). Latency per sample on the machine that ran it. See the [README](../README.md) for the data and its limitations.`,
  "",
];
for (const lang of ["tr", "en", "all"] as const) {
  lines.push(`## ${lang === "tr" ? "Turkish" : lang === "en" ? "English" : "Both languages"}`, "", "| System | Precision | Recall | F1 | False-positive rate |", "| --- | --- | --- | --- | --- |");
  const rows = results.map((r) => ({ r, s: r.scores.find((s) => s.lang === lang)! })).sort((a, b) => b.s.metrics.f1 - a.s.metrics.f1);
  for (const { r, s } of rows) {
    lines.push(`| ${r.system} | ${pct(s.metrics.precision)} (${range(s.intervals.precision)}) | ${pct(s.metrics.recall)} (${range(s.intervals.recall)}) | ${(s.metrics.f1 * 100).toFixed(1)} (${range(s.intervals.f1)}) | ${pct(s.metrics.fpr)} (${range(s.intervals.fpr)}) |`);
  }
  lines.push("");
}
lines.push("## By technique (share flagged: recall for attacks, false alarms for benign)", "", `| Language | Label | Technique | n | ${results.map((r) => r.system).join(" | ")} |`, `| --- | --- | --- | --- | ${results.map(() => "---").join(" | ")} |`);
for (const t of results[0]?.techniques ?? []) {
  const cells = results.map((r) => {
    const g = r.techniques.find((x) => x.lang === t.lang && x.label === t.label && x.technique === t.technique)!;
    return pct(g.flagged / g.n);
  });
  lines.push(`| ${t.lang} | ${t.label} | ${t.technique} | ${t.n} | ${cells.join(" | ")} |`);
}
lines.push("", "## Latency and settings", "", "| System | Version | ms/sample (mean / p95) | Settings |", "| --- | --- | --- | --- |");
for (const r of results) lines.push(`| ${r.system} | ${r.version} | ${r.latency.meanMs.toFixed(2)} / ${r.latency.p95Ms.toFixed(2)} | ${r.settings} |`);
lines.push("");
fs.writeFileSync(path.join(dir, `LEADERBOARD.${split}.md`), lines.join("\n"));
process.stdout.write(lines.join("\n") + "\n");
