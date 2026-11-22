import type { Grade, NormalizedFinding } from "./types.js";

export function gradeFromFindings(findings: NormalizedFinding[]): { grade: Grade; score: number } {
  const trifecta = (f: NormalizedFinding) => f.patternId === "lethal_trifecta" || f.patternId === "cross_server_lethal_trifecta";
  if (findings.some((f) => trifecta(f) || f.severity === "critical")) {
    if (findings.some(trifecta)) return { grade: "F", score: 0 };
    return { grade: "D", score: 25 };
  }
  if (findings.some((f) => f.severity === "high")) return { grade: "C", score: 50 };
  if (findings.some((f) => f.severity === "medium")) return { grade: "B", score: 75 };
  if (findings.some((f) => f.severity === "low")) return { grade: "B", score: 85 };
  return { grade: "A", score: 100 };
}
