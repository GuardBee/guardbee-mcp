/** Binary classification metrics with bootstrap intervals (positives and negatives resampled separately). */

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface Metrics extends Counts {
  precision: number;
  recall: number;
  f1: number;
  /** False-positive rate. */
  fpr: number;
}

export interface Interval {
  low: number;
  high: number;
}

export function metrics(pairs: { positive: boolean; predicted: boolean }[]): Metrics {
  const c: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const p of pairs) {
    if (p.positive && p.predicted) c.tp++;
    else if (p.predicted) c.fp++;
    else if (p.positive) c.fn++;
    else c.tn++;
  }
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 1;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const fpr = c.fp + c.tn ? c.fp / (c.fp + c.tn) : 0;
  return { ...c, precision, recall, f1, fpr };
}

/** Deterministic PRNG (mulberry32), so intervals reproduce. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrap(pairs: { positive: boolean; predicted: boolean }[], samples = 1000, seed = 42): Record<"precision" | "recall" | "f1" | "fpr", Interval> {
  const rand = rng(seed);
  const sets = [pairs.filter((p) => p.positive), pairs.filter((p) => !p.positive)];
  const draws: Record<string, number[]> = { precision: [], recall: [], f1: [], fpr: [] };
  for (let s = 0; s < samples; s++) {
    const sample = sets.flatMap((set) => set.map(() => set[Math.floor(rand() * set.length)]!));
    const m = metrics(sample);
    for (const key of Object.keys(draws)) draws[key]!.push(m[key as keyof Metrics] as number);
  }
  const interval = (list: number[]): Interval => {
    const sorted = [...list].sort((a, b) => a - b);
    return { low: sorted[Math.floor(sorted.length * 0.025)]!, high: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.975))]! };
  };
  return { precision: interval(draws["precision"]!), recall: interval(draws["recall"]!), f1: interval(draws["f1"]!), fpr: interval(draws["fpr"]!) };
}
