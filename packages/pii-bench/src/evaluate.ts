import { CATEGORIES, IDENTIFIER_CATEGORIES, isCategory, type Category, type Doc } from "./categories.js";
import { rng } from "./identities.js";
import type { Detection } from "./systems.js";

/**
 * Matching: a detection and a label match when they overlap and have the same
 * category. Precision counts detections that match a label; recall counts
 * labels some detection matches. Coverage is the privacy view, blind to
 * categories: a label counts as masked only when detections cover every
 * character of it, since half a name or the last digits of an IBAN still
 * identify someone.
 */

/** A detection whose category is not in the label set (a credential pattern): always a false positive. */
const OTHER = "other";
type Bucket = Category | typeof OTHER;

/** Per-document counts; metrics are sums over documents, so a bootstrap sample just re-sums. */
export interface DocCounts {
  set: Doc["set"];
  gold: Partial<Record<Bucket, number>>;
  found: Partial<Record<Bucket, number>>;
  predicted: Partial<Record<Bucket, number>>;
  correct: Partial<Record<Bucket, number>>;
  covered: Partial<Record<Bucket, number>>;
  /** Any detection at all (a clean document with one is a false alarm). */
  flagged: boolean;
}

const add = (counts: Partial<Record<Bucket, number>>, key: Bucket, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export function countDoc(doc: Doc, detections: Detection[]): DocCounts {
  const counts: DocCounts = { set: doc.set, gold: {}, found: {}, predicted: {}, correct: {}, covered: {}, flagged: detections.length > 0 };
  for (const span of doc.spans) {
    add(counts.gold, span.category);
    if (detections.some((d) => d.category === span.category && overlaps(d, span))) add(counts.found, span.category);
    const hit = new Uint8Array(span.end - span.start);
    for (const d of detections) for (let i = Math.max(d.start, span.start); i < Math.min(d.end, span.end); i++) hit[i - span.start] = 1;
    if (hit.every(Boolean)) add(counts.covered, span.category);
  }
  for (const d of detections) {
    const bucket: Bucket = isCategory(d.category) ? d.category : OTHER;
    add(counts.predicted, bucket);
    if (doc.spans.some((span) => span.category === d.category && overlaps(d, span))) add(counts.correct, bucket);
  }
  return counts;
}

export interface Metrics {
  perCategory: Record<Category, { support: number; precision: number | null; recall: number | null; f1: number | null; coverage: number | null }>;
  /** Over every category, including the ones a system has no detector for. */
  micro: { precision: number | null; recall: number | null; f1: number | null; coverage: number | null };
  /** Over the identifier categories only (guard-core's regex scope). */
  identifiers: { precision: number | null; recall: number | null; f1: number | null; coverage: number | null };
  /** Share of clean documents with at least one detection. */
  falseAlarmRate: number | null;
  /** Detections outside the label set (credential patterns) across all documents. */
  otherDetections: number;
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
const f1 = (p: number | null, r: number | null) => (p === null || r === null ? null : p + r === 0 ? 0 : (2 * p * r) / (p + r));

function sum(docs: DocCounts[], field: "gold" | "found" | "predicted" | "correct" | "covered", keys: readonly Bucket[]): number {
  let total = 0;
  for (const doc of docs) for (const key of keys) total += doc[field][key] ?? 0;
  return total;
}

function pooled(docs: DocCounts[], keys: readonly Bucket[]) {
  const precision = ratio(sum(docs, "correct", keys), sum(docs, "predicted", keys));
  const recall = ratio(sum(docs, "found", keys), sum(docs, "gold", keys));
  return { precision, recall, f1: f1(precision, recall), coverage: ratio(sum(docs, "covered", keys), sum(docs, "gold", keys)) };
}

export function metrics(docs: DocCounts[]): Metrics {
  const perCategory = Object.fromEntries(
    CATEGORIES.map((category) => [category, { support: sum(docs, "gold", [category]), ...pooled(docs, [category]) }]),
  ) as Metrics["perCategory"];
  const clean = docs.filter((doc) => doc.set === "clean");
  return {
    perCategory,
    // Detections outside the label set lower precision: they masked something that was not personal data
    micro: pooled(docs, [...CATEGORIES, OTHER]),
    identifiers: pooled(docs, [...IDENTIFIER_CATEGORIES, OTHER]),
    falseAlarmRate: ratio(clean.filter((doc) => doc.flagged).length, clean.length),
    otherDetections: sum(docs, "predicted", [OTHER]),
  };
}

export type Interval = [low: number, high: number] | null;

/**
 * 95% percentile intervals from a document-level bootstrap: resample the PII
 * and clean documents (each set to its own size) with replacement and
 * recompute. Seeded, so a rerun gives the same intervals.
 */
export function bootstrap(docs: DocCounts[], samples: number, seed: number): Map<string, Interval> {
  const rand = rng(seed);
  const bySet = [docs.filter((doc) => doc.set === "pii"), docs.filter((doc) => doc.set === "clean")];
  const draws = new Map<string, number[]>();
  for (let s = 0; s < samples; s++) {
    const sample: DocCounts[] = [];
    for (const set of bySet) for (let i = 0; i < set.length; i++) sample.push(set[Math.floor(rand() * set.length)]!);
    for (const [key, value] of flatten(metrics(sample))) {
      if (value === null) continue;
      let list = draws.get(key);
      if (!list) draws.set(key, (list = []));
      list.push(value);
    }
  }
  const intervals = new Map<string, Interval>();
  for (const [key, list] of draws) {
    list.sort((a, b) => a - b);
    intervals.set(key, [percentile(list, 0.025), percentile(list, 0.975)]);
  }
  return intervals;
}

/** Every numeric metric under a dotted key: `micro.f1`, `perCategory.iban.recall`. */
export function flatten(value: unknown, prefix = ""): [string, number | null][] {
  if (typeof value === "number" || value === null) return [[prefix, value]];
  if (typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => flatten(inner, prefix ? `${prefix}.${key}` : key));
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const position = (sorted.length - 1) * q;
  const [low, high] = [Math.floor(position), Math.ceil(position)];
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}
