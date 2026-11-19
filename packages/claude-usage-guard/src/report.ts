import { calibrate, toPlanPct } from "./forecast.js";
import type { ClaudePaths } from "./paths.js";
import { scanTranscripts, summarize, type GroupBy, type UsageGroup } from "./transcripts.js";

export interface UsageReport {
  sinceMs: number;
  groupBy: GroupBy;
  groups: UsageGroup[];
  totalWeighted: number;
  calls: number;
  /** Weighted tokens per point of the 5-hour meter, when calibrated */
  tokensPerPct5h?: number;
}

export function usageReport(options: { hours?: number; groupBy?: GroupBy; paths?: Partial<ClaudePaths>; now?: number } = {}): UsageReport {
  const now = options.now ?? Date.now();
  const sinceMs = now - (options.hours ?? 24) * 3_600_000;
  const groupBy = options.groupBy ?? "session";
  const { usage } = scanTranscripts({ paths: options.paths, sinceMs, untilMs: now });
  const groups = summarize(usage, groupBy);
  const { tokensPerPct } = calibrate({ paths: options.paths, now });
  return { sinceMs, groupBy, groups, totalWeighted: groups.reduce((s, g) => s + g.weighted, 0), calls: usage.length, tokensPerPct5h: tokensPerPct.five_hour };
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}

export function formatUsageReport(report: UsageReport, limit = 15): string {
  if (report.calls === 0) return `No Claude Code calls on this machine since ${new Date(report.sinceMs).toISOString()}.`;
  const lines = [
    `Claude Code usage on this machine since ${new Date(report.sinceMs).toISOString()}: ${report.calls} calls, ${compact(report.totalWeighted)} weighted tokens`,
    `(weighted = input + 1.25×cache write + 0.1×cache read + 5×output, scaled by model; this is what plan limits track)`,
    "",
    `${report.groupBy.padEnd(38)} calls  weighted  share  out    cacheRd  peak ctx${report.tokensPerPct5h ? "  5h plan" : ""}`,
  ];
  const calibration = { tokensPerPct: { five_hour: report.tokensPerPct5h } };
  for (const g of report.groups.slice(0, limit)) {
    const share = report.totalWeighted ? (100 * g.weighted) / report.totalWeighted : 0;
    lines.push(
      `${g.key.slice(-38).padEnd(38)} ${String(g.calls).padStart(5)}  ${compact(g.weighted).padStart(8)}  ${share.toFixed(0).padStart(4)}%  ${compact(g.output).padStart(5)}  ${compact(g.cacheRead).padStart(7)}  ${compact(g.peakContext).padStart(8)}${report.tokensPerPct5h ? `  ${toPlanPct(g.weighted, "five_hour", calibration)!.toFixed(1).padStart(6)}%` : ""}`
    );
  }
  if (report.groups.length > limit) lines.push(`… ${report.groups.length - limit} more`);
  if (report.tokensPerPct5h) lines.push("", "5h plan = share of a full 5-hour limit, from the calibration (a session spread over several windows can exceed 100%).");
  return lines.join("\n");
}
