import { readAccount, readPlanUtilization, type AccountInfo } from "./account.js";
import type { ClaudePaths } from "./paths.js";
import { readSnapshots, recordSnapshot, toSnapshot, type UsageSnapshot } from "./snapshots.js";
import { listLiveSessions, remoteLogins, type LiveSession, type RemoteLogin } from "./signals.js";
import { scanTranscripts, summarize, weightedTokens, type UsageRecord } from "./transcripts.js";

/** Between two snapshots: how far the plan meter moved and how much this machine spent. */
export interface UsageInterval {
  from: number;
  to: number;
  window: "five_hour" | "seven_day";
  /** Percentage points the plan meter rose */
  deltaPct: number;
  /** This machine's cost-weighted Claude Code tokens in the interval */
  localWeighted: number;
  /** Points the local tokens account for, once calibrated */
  explainedPct?: number;
  /** Points nothing on this machine accounts for */
  unexplainedPct: number;
  flagged: boolean;
  reason?: string;
}

export type Verdict = "insufficient-data" | "no-evidence" | "suspicious" | "likely-other-usage";

export interface Signal {
  severity: "high" | "medium" | "low" | "info";
  title: string;
  detail: string;
}

export interface DetectionReport {
  verdict: Verdict;
  account?: AccountInfo;
  snapshots: number;
  snapshotRecorded: boolean;
  /** Weighted tokens per plan-meter point, learned from intervals this machine fully explains */
  tokensPerPct?: number;
  intervals: UsageInterval[];
  signals: Signal[];
  liveSessions: LiveSession[];
  remoteLogins: RemoteLogin[];
}

export interface DetectOptions {
  paths?: Partial<ClaudePaths>;
  /** Plan-meter rise (points) that must go unexplained before an interval is flagged */
  minUnexplainedPct?: number;
  /** Store the current plan reading before analysing (default true) */
  record?: boolean;
  /** Injected for tests */
  now?: number;
  liveSessions?: LiveSession[];
  remoteLogins?: RemoteLogin[];
}

// Below this a machine counts as idle: a few short replies, not a working session
const IDLE_WEIGHTED = 5_000;
const NON_INTERACTIVE = /^sdk|^claude-desktop-api|^github|^remote/;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function localBetween(usage: UsageRecord[], from: number, to: number): number {
  let total = 0;
  for (const r of usage) if (r.ts > from && r.ts <= to) total += weightedTokens(r);
  return total;
}

/**
 * Pairs consecutive snapshots inside the same limit window. The five-hour meter moves fastest, so
 * it is preferred; a pair whose reset time differs straddles a reset and is skipped.
 */
export function buildIntervals(snapshots: UsageSnapshot[], usage: UsageRecord[]): UsageInterval[] {
  const intervals: UsageInterval[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1];
    const b = snapshots[i];
    let window: UsageInterval["window"] | undefined;
    let delta = 0;
    if (a.fiveHour !== undefined && b.fiveHour !== undefined && a.fiveHourResetsAt === b.fiveHourResetsAt) {
      window = "five_hour";
      delta = b.fiveHour - a.fiveHour;
    } else if (a.sevenDay !== undefined && b.sevenDay !== undefined && a.sevenDayResetsAt === b.sevenDayResetsAt) {
      window = "seven_day";
      delta = b.sevenDay - a.sevenDay;
    }
    if (!window || delta < 0) continue;
    intervals.push({
      from: a.at,
      to: b.at,
      window,
      deltaPct: delta,
      localWeighted: localBetween(usage, a.at, b.at),
      unexplainedPct: 0,
      flagged: false,
    });
  }
  return intervals;
}

/**
 * Learns how many weighted tokens one point of each meter costs, from intervals where this machine
 * was busy, then flags intervals the machine's own usage cannot account for. An interval where the
 * meter rose while this machine was idle needs no calibration to be flagged.
 */
export function analyseIntervals(
  intervals: UsageInterval[],
  minUnexplainedPct = 3
): { intervals: UsageInterval[]; tokensPerPct: Partial<Record<UsageInterval["window"], number>> } {
  const tokensPerPct: Partial<Record<UsageInterval["window"], number>> = {};
  for (const window of ["five_hour", "seven_day"] as const) {
    const ratios = intervals
      .filter((iv) => iv.window === window && iv.deltaPct >= 2 && iv.localWeighted > IDLE_WEIGHTED)
      .map((iv) => iv.localWeighted / iv.deltaPct);
    // Foreign usage inside a calibration interval lowers its ratio, so the upper half is trusted more
    const upper = ratios.sort((x, y) => x - y).slice(Math.floor(ratios.length / 2));
    if (ratios.length >= 3) tokensPerPct[window] = median(upper);
  }

  const analysed = intervals.map((iv) => {
    const out = { ...iv };
    const rate = tokensPerPct[iv.window];
    // Meters are whole percentages, so one point of drift is rounding, not usage
    const delta = Math.max(0, iv.deltaPct - 1);
    if (iv.localWeighted <= IDLE_WEIGHTED) {
      out.unexplainedPct = delta;
      if (delta >= Math.max(1, minUnexplainedPct - 1)) {
        out.flagged = true;
        out.reason = `plan meter rose ${iv.deltaPct} pt while Claude Code on this machine was idle`;
      }
    } else if (rate) {
      out.explainedPct = iv.localWeighted / rate;
      out.unexplainedPct = Math.max(0, delta - out.explainedPct);
      if (out.unexplainedPct >= minUnexplainedPct && out.unexplainedPct >= 0.5 * iv.deltaPct) {
        out.flagged = true;
        out.reason = `this machine accounts for ~${out.explainedPct.toFixed(1)} of ${iv.deltaPct} pt`;
      }
    }
    return out;
  });
  return { intervals: analysed, tokensPerPct };
}

export function detectForeignUsage(options: DetectOptions = {}): DetectionReport {
  const now = options.now ?? Date.now();
  const account = readAccount(options.paths);
  const plan = readPlanUtilization(options.paths);
  const signals: Signal[] = [];

  let snapshotRecorded = false;
  if (plan && options.record !== false) snapshotRecorded = recordSnapshot(toSnapshot(plan), options.paths);
  const snapshots = readSnapshots(options.paths);

  const since = snapshots.length ? Math.min(snapshots[0].at, now - 7 * 86_400_000) : now - 7 * 86_400_000;
  const { usage } = scanTranscripts({ paths: options.paths, sinceMs: since });
  const { intervals, tokensPerPct } = analyseIntervals(buildIntervals(snapshots, usage), options.minUnexplainedPct);

  if (!plan) {
    signals.push({
      severity: "info",
      title: "No plan usage reading",
      detail: "Claude Code has not cached plan utilization (open /usage once, or this is an API-key login). Only local signals were checked.",
    });
  }
  if (plan?.accountUuid && account?.accountUuid && plan.accountUuid !== account.accountUuid) {
    signals.push({
      severity: "high",
      title: "Plan reading belongs to a different account",
      detail: "The cached plan usage was fetched for another account than the one signed in now; someone switched logins on this machine.",
    });
  }

  const flagged = intervals.filter((iv) => iv.flagged);
  for (const iv of flagged) {
    signals.push({
      severity: iv.localWeighted <= IDLE_WEIGHTED ? "high" : "medium",
      title: `Unexplained usage ${new Date(iv.from).toISOString()} → ${new Date(iv.to).toISOString()}`,
      detail: `${iv.reason} (${iv.window.replace("_", "-")} meter, ~${iv.unexplainedPct.toFixed(1)} pt unexplained).`,
    });
  }

  const weekUsage = usage.filter((r) => r.ts >= now - 7 * 86_400_000);
  const byEntry = summarize(weekUsage, "entrypoint");
  const total = byEntry.reduce((sum, g) => sum + g.weighted, 0);
  for (const g of byEntry) {
    if (!NON_INTERACTIVE.test(g.key) || total === 0) continue;
    const share = g.weighted / total;
    if (share < 0.05) continue;
    signals.push({
      severity: share >= 0.3 ? "medium" : "low",
      title: `Non-interactive use of your login: ${g.key}`,
      detail: `${(share * 100).toFixed(0)}% of this machine's weekly usage came from ${g.key} (${g.calls} calls): scripts, SDK apps or CI calling Claude with your credentials.`,
    });
  }

  const live = options.liveSessions ?? listLiveSessions(options.paths);
  const remote = options.remoteLogins ?? remoteLogins();
  for (const login of remote) {
    signals.push({
      severity: "medium",
      title: `Remote login on this machine: ${login.user}@${login.host}`,
      detail: `${login.tty} since ${login.since}. Anyone with a shell here can run Claude Code under the signed-in account.`,
    });
  }
  const background = live.filter((s) => s.alive && s.kind !== "interactive");
  if (background.length) {
    signals.push({
      severity: "info",
      title: `${background.length} non-interactive Claude Code process(es) running`,
      detail: background.map((s) => `pid ${s.pid} (${s.kind}, ${s.entrypoint}) in ${s.cwd}`).join("; "),
    });
  }

  // A busy interval whose meter rose past rounding can only be judged once that window is calibrated
  const undecided = intervals.filter((iv) => iv.localWeighted > IDLE_WEIGHTED && iv.deltaPct >= 2 && !tokensPerPct[iv.window]);
  let verdict: Verdict;
  if (signals.some((s) => s.severity === "high")) verdict = "likely-other-usage";
  else if (signals.some((s) => s.severity === "medium")) verdict = "suspicious";
  else if (intervals.length === 0 || undecided.length === intervals.length) verdict = "insufficient-data";
  else verdict = "no-evidence";

  return {
    verdict,
    account,
    snapshots: snapshots.length,
    snapshotRecorded,
    tokensPerPct: tokensPerPct.five_hour ?? tokensPerPct.seven_day,
    intervals,
    signals,
    liveSessions: live,
    remoteLogins: remote,
  };
}

const VERDICT_TEXT: Record<Verdict, string> = {
  "insufficient-data":
    "Not enough plan readings yet to compare. Run this again after Claude Code refreshes /usage a few times (or schedule `guardbee-claude-usage-guard snapshot`).",
  "no-evidence": "Plan usage matches this machine's Claude Code usage. No sign of use elsewhere.",
  suspicious: "Some signals need a look; see below.",
  "likely-other-usage":
    "The plan meter rose by more than this machine's Claude Code explains. That usage came from elsewhere: another device or person signed in to the account, or your own claude.ai / desktop / mobile chats, which share the same limits.",
};

export function formatReport(report: DetectionReport): string {
  const lines: string[] = [];
  const icon = { "insufficient-data": "ℹ️", "no-evidence": "✅", suspicious: "⚠️", "likely-other-usage": "🚨" }[report.verdict];
  lines.push(`${icon} ${report.verdict}: ${VERDICT_TEXT[report.verdict]}`);
  if (report.account) {
    const a = report.account;
    lines.push(`Account: ${a.email ?? "?"}${a.organizationName ? ` (${a.organizationName})` : ""}${a.rateLimitTier ? `, tier ${a.rateLimitTier}` : ""}`);
  }
  lines.push(`Snapshots: ${report.snapshots}${report.snapshotRecorded ? " (+1 recorded now)" : ""}; intervals compared: ${report.intervals.length}; flagged: ${report.intervals.filter((i) => i.flagged).length}`);
  if (report.tokensPerPct) lines.push(`Calibration: ~${Math.round(report.tokensPerPct).toLocaleString("en-US")} weighted tokens per plan-meter point`);
  if (report.signals.length) {
    lines.push("");
    for (const s of report.signals) lines.push(`[${s.severity.toUpperCase()}] ${s.title}\n  ${s.detail}`);
  }
  const live = report.liveSessions.filter((s) => s.alive);
  if (live.length) {
    lines.push("", `Live Claude Code sessions on this machine (${live.length}):`);
    for (const s of live) lines.push(`  pid ${s.pid}  ${s.status.padEnd(5)}  ${s.entrypoint}  ${s.cwd}`);
  }
  lines.push(
    "",
    "Only this machine's Claude Code is visible here; other devices show up only as unexplained plan usage. If you suspect someone else, change the account password and sign out of other sessions from your claude.ai account settings."
  );
  return lines.join("\n");
}
