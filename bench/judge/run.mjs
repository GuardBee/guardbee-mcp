#!/usr/bin/env node
// Judge benchmark: precision and recall of the deterministic rules, the LLM judge, and both.
//   GUARDBEE_JUDGE_URL=http://127.0.0.1:11434/v1 GUARDBEE_JUDGE_MODEL=qwen2.5:3b node bench/judge/run.mjs
// Needs the packages built (pnpm turbo run build). Writes bench/judge/results-<model>.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Judge, judgeFromEnv, scanForPromptInjection } from "../../packages/guard-core/dist/index.js";
import { scanText, judgeText } from "../../packages/tool-poisoning-scanner/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = judgeFromEnv();
if (!config) {
  console.error("Set GUARDBEE_JUDGE_URL and GUARDBEE_JUDGE_MODEL");
  process.exit(2);
}
const judge = new Judge({ ...config, cacheSize: 0 });
const read = (file) => fs.readFileSync(path.join(here, file), "utf8").trim().split("\n").map((l) => JSON.parse(l));

function score(rows, predicted) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  rows.forEach((row, i) => {
    const positive = row.label === "attack" || row.label === "misaligned";
    if (predicted[i] && positive) tp++;
    else if (predicted[i]) fp++;
    else if (positive) fn++;
    else tn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1 };
}
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const line = (name, s) => `| ${name} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.f1.toFixed(2)} | ${s.tp} | ${s.fp} | ${s.fn} |`;

// ── Injection ──────────────────────────────────────────────────────────────
const injection = read("injection.jsonl");
const rulesBlock = [], rulesAny = [], judged = [], latencies = [];
let model;
for (const row of injection) {
  const rules = scanForPromptInjection(row.text).action;
  rulesBlock.push(rules === "block");
  rulesAny.push(rules !== "allow");
  const verdict = await judge.classifyInjection(row.text, { where: row.kind === "tool-result" ? "tool result" : "document" });
  model ??= verdict.model;
  latencies.push(verdict.latencyMs);
  judged.push(verdict.verdict === "malicious" && verdict.confidence >= 0.7);
}
// The proxy's mode: rules block; a rules warn is raised to a block when the judge says malicious
const proxyMode = injection.map((_, i) => rulesBlock[i] || (rulesAny[i] && judged[i]));
const either = injection.map((_, i) => rulesBlock[i] || judged[i]);

// ── Alignment ──────────────────────────────────────────────────────────────
const alignment = read("alignment.jsonl");
const alignRules = [], alignJudge = [];
for (const row of alignment) {
  const source = `import { z } from "zod";\n${row.code}\n`;
  alignRules.push(scanText(source, "server.ts").some((f) => f.category === "confused-deputy"));
  const found = await judgeText(source, "server.ts", judge);
  alignJudge.push(found.length > 0);
}
const alignBoth = alignment.map((_, i) => alignRules[i] || alignJudge[i]);

const sorted = [...latencies].sort((a, b) => a - b);
const by = (lang) => {
  const idx = injection.map((r, i) => (r.lang === lang ? i : -1)).filter((i) => i >= 0);
  const rows = idx.map((i) => injection[i]);
  return [score(rows, idx.map((i) => rulesBlock[i])), score(rows, idx.map((i) => either[i]))];
};
const [enRules, enBoth] = by("en");
const [trRules, trBoth] = by("tr");
const name = `${model.name}${model.version ? ` (${model.version})` : ""}`;
const md = `# Judge benchmark: ${name}

${new Date().toISOString().slice(0, 10)} · ${injection.length} injection samples (${injection.filter((r) => r.label === "attack").length} attacks, ${injection.filter((r) => r.label === "benign").length} benign; English and Turkish) · ${alignment.length} tool alignment cases · median judge latency ${sorted[Math.floor(sorted.length / 2)]} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]} ms (local, this machine).

## Prompt injection

| Detector | Precision | Recall | F1 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
${line("Rules (block)", score(injection, rulesBlock))}
${line("Rules (block or warn)", score(injection, rulesAny))}
${line("Judge only", score(injection, judged))}
${line("Proxy, judge.scope: borderline (rules warn → judge)", score(injection, proxyMode))}
${line("Rules or judge (scanner --judge; proxy judge.scope: results)", score(injection, either))}

By language, rules (block) → rules or judge: English recall ${pct(enRules.recall)} → ${pct(enBoth.recall)}, precision ${pct(enRules.precision)} → ${pct(enBoth.precision)}; Turkish recall ${pct(trRules.recall)} → ${pct(trBoth.recall)}, precision ${pct(trRules.precision)} → ${pct(trBoth.precision)}.

## Description vs. behavior (tool-poisoning-scanner)

| Detector | Precision | Recall | F1 | TP | FP | FN |
| --- | --- | --- | --- | --- | --- | --- |
${line("Rules (confused-deputy sinks)", score(alignment, alignRules))}
${line("Judge only", score(alignment, alignJudge))}
${line("Rules or judge (--judge)", score(alignment, alignBoth))}
`;
const out = path.join(here, `results-${model.name.replace(/[^\w.-]+/g, "_")}.md`);
fs.writeFileSync(out, md);
console.log(md);
console.log(`→ ${out}`);
