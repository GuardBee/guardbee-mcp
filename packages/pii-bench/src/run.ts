/**
 * `pnpm bench [--system <name>] [--samples <n>]`: run a system over the
 * dataset, print a markdown report, write results/<system>.json and .md, and
 * update the system's results block in README.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { CATEGORIES, IDENTIFIER_CATEGORIES, type Doc } from "./categories.js";
import { bootstrap, countDoc, metrics, percentile, type Interval, type Metrics } from "./evaluate.js";
import { DATASET_PATH } from "./generate.js";
import { SYSTEMS, type Detection, type System } from "./systems.js";

export const BOOTSTRAP_SEED = 7;

export const loadDataset = (path = DATASET_PATH): Doc[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Doc);

export interface Report {
  system: { name: string; description: string };
  dataset: { name: string; documents: number; pii: number; clean: number; spans: number };
  metrics: Metrics;
  /** 95% bootstrap intervals by dotted metric key (`micro.f1`). */
  intervals: Record<string, Interval>;
  bootstrapSamples: number;
  /** Milliseconds per document, after a warm-up pass. */
  latencyMs: { p50: number; p95: number; mean: number };
  node: string;
}

export async function evaluate(system: System, docs: Doc[], samples = 1000): Promise<Report> {
  for (const doc of docs) await system.detect(doc.text);
  const times: number[] = [];
  const detections: Detection[][] = [];
  for (const doc of docs) {
    const start = performance.now();
    detections.push(await system.detect(doc.text));
    times.push(performance.now() - start);
  }
  const counts = docs.map((doc, i) => countDoc(doc, detections[i]!));
  times.sort((a, b) => a - b);
  return {
    system: { name: system.name, description: system.description },
    dataset: {
      name: "tr-pii-v1",
      documents: docs.length,
      pii: docs.filter((doc) => doc.set === "pii").length,
      clean: docs.filter((doc) => doc.set === "clean").length,
      spans: docs.reduce((n, doc) => n + doc.spans.length, 0),
    },
    metrics: metrics(counts),
    intervals: Object.fromEntries(bootstrap(counts, samples, BOOTSTRAP_SEED)),
    bootstrapSamples: samples,
    latencyMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95), mean: times.reduce((a, b) => a + b, 0) / times.length },
    node: process.version,
  };
}

const pct = (value: number | null) => (value === null ? "–" : `${(value * 100).toFixed(1)}`);
const withCi = (report: Report, key: string, value: number | null) => {
  const ci = report.intervals[key];
  return value === null ? "–" : ci ? `${pct(value)} (${pct(ci[0])}–${pct(ci[1])})` : pct(value);
};

export function toMarkdown(report: Report): string {
  const { metrics: m } = report;
  const lines = [
    `### ${report.system.name}`,
    "",
    `${report.system.description}. Dataset ${report.dataset.name}: ${report.dataset.pii} documents with personal data (${report.dataset.spans} labeled spans), ${report.dataset.clean} without. Percentages with 95% bootstrap intervals (${report.bootstrapSamples} document-level resamples).`,
    "",
    "| | Precision | Recall | F1 | Fully masked |",
    "|---|---|---|---|---|",
    `| **All categories** | ${withCi(report, "micro.precision", m.micro.precision)} | ${withCi(report, "micro.recall", m.micro.recall)} | ${withCi(report, "micro.f1", m.micro.f1)} | ${withCi(report, "micro.coverage", m.micro.coverage)} |`,
    `| **Identifiers** | ${withCi(report, "identifiers.precision", m.identifiers.precision)} | ${withCi(report, "identifiers.recall", m.identifiers.recall)} | ${withCi(report, "identifiers.f1", m.identifiers.f1)} | ${withCi(report, "identifiers.coverage", m.identifiers.coverage)} |`,
    "",
    `False-alarm rate (clean documents with any detection): ${withCi(report, "falseAlarmRate", m.falseAlarmRate)}%. Latency per document: p50 ${report.latencyMs.p50.toFixed(3)} ms, p95 ${report.latencyMs.p95.toFixed(3)} ms (Node ${report.node}).`,
    "",
    "| Category | Labels | Precision | Recall | F1 | Fully masked |",
    "|---|---|---|---|---|---|",
  ];
  for (const category of CATEGORIES) {
    const c = m.perCategory[category];
    const key = `perCategory.${category}`;
    const name = (IDENTIFIER_CATEGORIES as readonly string[]).includes(category) ? category : `${category} †`;
    lines.push(`| ${name} | ${c.support} | ${withCi(report, `${key}.precision`, c.precision)} | ${withCi(report, `${key}.recall`, c.recall)} | ${withCi(report, `${key}.f1`, c.f1)} | ${withCi(report, `${key}.coverage`, c.coverage)} |`);
  }
  lines.push("", "† Person names and KVKK Art. 6 special categories: guard-core has no regex detector for them.", "");
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { system: { type: "string", default: "guard-core-regex" }, samples: { type: "string", default: "1000" } } });
  const system = SYSTEMS[values.system!];
  if (!system) throw new Error(`unknown system "${values.system}" (one of ${Object.keys(SYSTEMS).join(", ")})`);
  const report = await evaluate(system, loadDataset(), Number(values.samples));
  const out = (ext: string) => fileURLToPath(new URL(`../results/${system.name}.${ext}`, import.meta.url));
  writeFileSync(out("json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(out("md"), toMarkdown(report));
  // The README's results section for this system, between its markers
  const readme = fileURLToPath(new URL("../README.md", import.meta.url));
  const block = new RegExp(`(<!-- results:${system.name} -->\\n)[\\s\\S]*?(<!-- /results -->)`);
  writeFileSync(readme, readFileSync(readme, "utf8").replace(block, (_all, open: string, close: string) => `${open}${toMarkdown(report)}${close}`));
  console.log(toMarkdown(report));
}
