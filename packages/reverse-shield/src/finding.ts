import { getRule } from "./rules.js";
import type { RuleCategory, Severity, TargetKind } from "./rules.js";

export interface Finding {
  patternId: string;
  patternName: string;
  target: TargetKind;
  category: RuleCategory;
  severity: Severity;
  recommendation: string;
  /** Path of the artifact, with `!/inner/path` for files inside an archive (APK, ASAR). */
  file?: string;
  /** Artifacts are mostly binary — line/column are 1 unless a text match has a real position. */
  line: number;
  column: number;
  match: string;
  context: string;
}

export function finding(
  id: string,
  file: string | undefined,
  detail: { match?: string; context?: string; severity?: Severity; target?: TargetKind; line?: number; column?: number } = {},
): Finding {
  const rule = getRule(id);
  return {
    patternId: rule.id,
    patternName: rule.name,
    target: detail.target ?? rule.target,
    category: rule.category,
    severity: detail.severity ?? rule.severity,
    recommendation: rule.recommendation,
    file,
    line: detail.line ?? 1,
    column: detail.column ?? 1,
    match: detail.match ?? "",
    context: detail.context ?? rule.exposes,
  };
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function bySeverity(a: Finding, b: Finding): number {
  return RANK[a.severity] - RANK[b.severity];
}

/**
 * A–F reverse-engineering resistance grade: how much an analyst gets for free.
 * Driven by the worst finding, then nudged down by volume at that level.
 */
export function grade(findings: Finding[]): "A" | "B" | "C" | "D" | "F" {
  if (findings.length === 0) return "A";
  const worst = Math.min(...findings.map((f) => RANK[f.severity]));
  if (worst === RANK.critical) return "F";
  if (worst === RANK.high) return findings.filter((f) => f.severity === "high").length >= 3 ? "F" : "D";
  if (worst === RANK.medium) return "C";
  return "B";
}
