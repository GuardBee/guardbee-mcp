import type { Grade, NormalizedFinding } from "./types.js";

export function gradeFromFindings(findings: NormalizedFinding[]): { grade: Grade; score: number } {
  if (findings.some((f) => f.patternId === "lethal_trifecta" || f.severity === "critical")) {
    if (findings.some((f) => f.patternId === "lethal_trifecta")) return { grade: "F", score: 0 };
    return { grade: "D", score: 25 };
  }
  if (findings.some((f) => f.severity === "high")) return { grade: "C", score: 50 };
  if (findings.some((f) => f.severity === "medium")) return { grade: "B", score: 75 };
  if (findings.some((f) => f.severity === "low")) return { grade: "B", score: 85 };
  return { grade: "A", score: 100 };
}
