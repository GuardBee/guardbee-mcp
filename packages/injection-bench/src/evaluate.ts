import type { Lang, Sample } from "./data.js";
import { bootstrap, metrics, type Interval, type Metrics } from "./metrics.js";
import type { System } from "./systems.js";

export interface Score {
  lang: Lang | "all";
  n: number;
  metrics: Metrics;
  intervals: Record<"precision" | "recall" | "f1" | "fpr", Interval>;
}

export interface SystemScore {
  system: string;
  version: string;
  settings: string;
  scores: Score[];
  /** Share flagged per language and technique: recall for attack families, false-alarm rate for benign kinds. */
  techniques: { lang: Lang; label: Sample["label"]; technique: string; n: number; flagged: number }[];
  /** Milliseconds per sample: mean and 95th percentile. */
  latency: { meanMs: number; p95Ms: number };
  misses: string[];
  falseAlarms: string[];
}

export async function evaluate(system: System, samples: Sample[]): Promise<SystemScore> {
  const predicted = new Map<string, boolean>();
  const times: number[] = [];
  for (const s of samples) {
    const t0 = performance.now();
    predicted.set(s.id, await system.detect(s.text, s.lang));
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const pairs = (rows: Sample[]) => rows.map((s) => ({ positive: s.label === "attack", predicted: predicted.get(s.id)! }));
  const scores: Score[] = [];
  for (const lang of ["en", "tr", "all"] as const) {
    const rows = lang === "all" ? samples : samples.filter((s) => s.lang === lang);
    if (!rows.length) continue;
    scores.push({ lang, n: rows.length, metrics: metrics(pairs(rows)), intervals: bootstrap(pairs(rows)) });
  }
  const groups = new Map<string, SystemScore["techniques"][number]>();
  for (const s of samples) {
    const key = `${s.lang}|${s.label}|${s.technique}`;
    const g = groups.get(key) ?? { lang: s.lang, label: s.label, technique: s.technique, n: 0, flagged: 0 };
    g.n++;
    if (predicted.get(s.id)) g.flagged++;
    groups.set(key, g);
  }
  return {
    system: system.name,
    version: system.version,
    settings: system.settings,
    scores,
    techniques: [...groups.values()].sort((a, b) => a.lang.localeCompare(b.lang) || a.label.localeCompare(b.label) || a.technique.localeCompare(b.technique)),
    latency: { meanMs: times.reduce((a, b) => a + b, 0) / times.length, p95Ms: times[Math.floor(times.length * 0.95)] ?? 0 },
    misses: samples.filter((s) => s.label === "attack" && !predicted.get(s.id)).map((s) => s.id),
    falseAlarms: samples.filter((s) => s.label === "benign" && predicted.get(s.id)).map((s) => s.id),
  };
}
