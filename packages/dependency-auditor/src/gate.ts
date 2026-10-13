import { getSeverity } from "./osv.js";
import type { AuditResult } from "./osv.js";
import type { DependencyAuditorConfig } from "./config.js";

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };

/** CI gate: 1 if any finding meets --fail-on, --fail-on-kev or --fail-on-epss, else 0. */
export function gateExitCode(
  results: AuditResult[],
  cfg: Pick<DependencyAuditorConfig, "failOn" | "failOnKev" | "failOnEpss">
): number {
  const threshold = SEVERITY_RANK[cfg.failOn];
  for (const r of results) {
    for (const v of r.vulns) {
      if (threshold !== undefined && (SEVERITY_RANK[getSeverity(v)] ?? 4) <= threshold) return 1;
      if (cfg.failOnKev && v.exploit?.kev) return 1;
      if (cfg.failOnEpss !== null && (v.exploit?.epss?.score ?? 0) >= cfg.failOnEpss) return 1;
    }
  }
  return 0;
}
