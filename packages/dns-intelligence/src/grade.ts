import type { Finding } from "./dns.js";

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface DomainGrade {
  grade: Grade;
  /** 0–100 after deductions (critical 40, high 20, medium 8, low 2). */
  score: number;
  counts: Record<"critical" | "high" | "medium" | "low" | "info", number>;
}

const WEIGHT = { critical: 40, high: 20, medium: 8, low: 2, info: 0 } as const;

/**
 * A–F from findings. Deductions add up, and the worst finding caps the grade:
 * any critical is F, any high is at most C, any medium at most B. A domain
 * that does not exist is F.
 */
export function gradeFindings(findings: Finding[]): DomainGrade {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + WEIGHT[f.severity], 0));

  let grade: Grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const cap = (max: Grade) => {
    if ("ABCDF".indexOf(grade) < "ABCDF".indexOf(max)) grade = max;
  };
  if (counts.medium > 0) cap("B");
  if (counts.high > 0) cap("C");
  if (counts.critical > 0 || findings.some((f) => f.code === "DOMAIN_NOT_FOUND")) cap("F");
  return { grade, score, counts };
}

export function formatGrade(g: DomainGrade): string {
  const parts = (["critical", "high", "medium", "low"] as const).filter((k) => g.counts[k] > 0).map((k) => `${g.counts[k]} ${k}`);
  return `Grade ${g.grade} (${g.score}/100${parts.length ? `; ${parts.join(", ")}` : ""})`;
}

/** Summary table for several domains, worst grade first. */
export function formatGradeTable(results: Array<{ domain: string; findings: Finding[] }>): string {
  const rows = results
    .map((r) => ({ domain: r.domain, g: gradeFindings(r.findings) }))
    .sort((a, b) => a.g.score - b.g.score);
  const width = Math.max(6, ...rows.map((r) => r.domain.length));
  const lines = [
    `${"Domain".padEnd(width)}  Grade  Score  Crit  High  Med  Low`,
    `${"─".repeat(width)}  ─────  ─────  ────  ────  ───  ───`,
    ...rows.map(
      ({ domain, g }) =>
        `${domain.padEnd(width)}  ${g.grade.padEnd(5)}  ${String(g.score).padStart(5)}  ${String(g.counts.critical).padStart(4)}  ${String(g.counts.high).padStart(4)}  ${String(g.counts.medium).padStart(3)}  ${String(g.counts.low).padStart(3)}`
    ),
  ];
  return lines.join("\n");
}
