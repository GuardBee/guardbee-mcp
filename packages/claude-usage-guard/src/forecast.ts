import { readPlanUtilization, type PlanWindow } from "./account.js";
import { analyseIntervals, buildIntervals, type UsageInterval } from "./detect.js";
import type { ClaudePaths } from "./paths.js";
import { readSnapshots, recordSnapshot, sameReset, toSnapshot, type UsageSnapshot } from "./snapshots.js";
import { scanTranscripts, weightedTokens, type UsageRecord } from "./transcripts.js";

type Window = UsageInterval["window"];

export interface Calibration {
  /** Weighted tokens per plan-meter point, per window, once enough busy intervals exist */
  tokensPerPct: Partial<Record<Window, number>>;
  snapshots: UsageSnapshot[];
  usage: UsageRecord[];
}

const DAY = 86_400_000;

/** Learns weighted tokens per meter point from stored plan readings and this machine's transcripts. */
export function calibrate(options: { paths?: Partial<ClaudePaths>; now?: number; snapshots?: UsageSnapshot[]; usage?: UsageRecord[] } = {}): Calibration {
  const now = options.now ?? Date.now();
  const snapshots = options.snapshots ?? readSnapshots(options.paths);
  const since = snapshots.length ? Math.min(snapshots[0].at, now - 7 * DAY) : now - 7 * DAY;
  const usage = options.usage ?? scanTranscripts({ paths: options.paths, sinceMs: since }).usage;
  const { tokensPerPct } = analyseIntervals(buildIntervals(snapshots, usage));
  return { tokensPerPct, snapshots, usage };
}

/** Plan-meter points `weighted` tokens are worth in `window`, or undefined before calibration. */
export function toPlanPct(weighted: number, window: Window, calibration: Pick<Calibration, "tokensPerPct">): number | undefined {
  const rate = calibration.tokensPerPct[window];
  return rate ? weighted / rate : undefined;
}

export interface WindowForecast {
  window: Window;
  utilization: number;
  resetsAt?: string;
  /** Meter points per hour at the current pace */
  pctPerHour?: number;
  /** Where the pace came from */
  basis?: "plan-meter" | "local-usage";
  /** When the meter reaches 100% at this pace, if before the reset */
  limitAt?: number;
  /** Utilization expected at the reset if the pace holds */
  atReset?: number;
  /** The window has reset since this reading, so the meter is out of date */
  stale?: boolean;
}

export interface PlanForecast {
  fetchedAt?: number;
  windows: WindowForecast[];
  calibrated: boolean;
}

const WINDOW_SPAN: Record<Window, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * DAY };
const PACE_SPAN: Record<Window, number> = { five_hour: 3_600_000, seven_day: DAY };

function utilizationOf(s: UsageSnapshot, window: Window): number | undefined {
  return window === "five_hour" ? s.fiveHour : s.sevenDay;
}

function resetsOf(s: UsageSnapshot, window: Window): string | undefined {
  return window === "five_hour" ? s.fiveHourResetsAt : s.sevenDayResetsAt;
}

/**
 * Projects each limit window forward. The pace comes from the plan meter itself when two readings
 * inside the current window are far enough apart, which counts usage from every device; otherwise
 * from this machine's recent spend converted with the calibration.
 */
export function forecastWindow(
  window: Window,
  current: PlanWindow,
  fetchedAt: number,
  calibration: Calibration,
  now: number
): WindowForecast {
  const out: WindowForecast = { window, utilization: current.utilization, resetsAt: current.resetsAt };
  if (current.resetsAt && Date.parse(current.resetsAt) <= now) {
    out.stale = true;
    return out;
  }
  const span = PACE_SPAN[window];
  const sameWindow = calibration.snapshots.filter((s) => sameReset(resetsOf(s, window), current.resetsAt) && utilizationOf(s, window) !== undefined && s.at >= fetchedAt - span * 2);
  const earliest = sameWindow.find((s) => fetchedAt - s.at >= span / 4);
  if (earliest) {
    out.pctPerHour = ((current.utilization - (utilizationOf(earliest, window) as number)) / (fetchedAt - earliest.at)) * 3_600_000;
    out.basis = "plan-meter";
  } else {
    const recent = calibration.usage.filter((r) => r.ts > now - span).reduce((s, r) => s + weightedTokens(r), 0);
    const pct = toPlanPct(recent, window, calibration);
    if (pct !== undefined) {
      out.pctPerHour = (pct / span) * 3_600_000;
      out.basis = "local-usage";
    }
  }
  if (out.pctPerHour !== undefined && out.pctPerHour > 0) {
    const resetMs = current.resetsAt ? Date.parse(current.resetsAt) : fetchedAt + WINDOW_SPAN[window];
    const hoursLeft = Math.max(0, (resetMs - now) / 3_600_000);
    out.atReset = Math.min(100, current.utilization + out.pctPerHour * hoursLeft);
    const limitAt = now + ((100 - current.utilization) / out.pctPerHour) * 3_600_000;
    if (limitAt < resetMs) out.limitAt = limitAt;
  }
  return out;
}

export function planForecast(options: { paths?: Partial<ClaudePaths>; now?: number; record?: boolean } = {}): PlanForecast {
  const now = options.now ?? Date.now();
  const plan = readPlanUtilization(options.paths);
  if (plan && options.record !== false) recordSnapshot(toSnapshot(plan), options.paths);
  const calibration = calibrate({ paths: options.paths, now });
  const windows: WindowForecast[] = [];
  if (plan?.fiveHour) windows.push(forecastWindow("five_hour", plan.fiveHour, plan.fetchedAt, calibration, now));
  if (plan?.sevenDay) windows.push(forecastWindow("seven_day", plan.sevenDay, plan.fetchedAt, calibration, now));
  return { fetchedAt: plan?.fetchedAt, windows, calibrated: Object.keys(calibration.tokensPerPct).length > 0 };
}

function clock(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function formatForecast(forecast: PlanForecast): string {
  if (forecast.windows.length === 0) return "No plan meters cached; run /usage in Claude Code once.";
  const lines = [`Plan meters as of ${forecast.fetchedAt ? clock(forecast.fetchedAt) : "?"}:`];
  for (const w of forecast.windows) {
    const name = w.window === "five_hour" ? "5-hour" : "7-day ";
    let line = `  ${name}: ${w.utilization}%`;
    if (w.stale) line = `  ${name}: reset since this reading (${w.utilization}% then); Claude Code refreshes it at startup or /usage`;
    else if (w.pctPerHour === undefined) line += " — pace unknown (needs two readings in this window, or calibration)";
    else {
      const pace = w.window === "five_hour" ? `${w.pctPerHour.toFixed(1)} pt/hour` : `${(w.pctPerHour * 24).toFixed(1)} pt/day`;
      line += `, ${pace} (from ${w.basis === "plan-meter" ? "the plan meter, all devices" : "this machine's usage"})`;
      if (w.limitAt) line += `\n    ⚠️ at this pace the limit is reached ${clock(w.limitAt)}, before the reset${w.resetsAt ? ` (${clock(Date.parse(w.resetsAt))})` : ""}`;
      else if (w.atReset !== undefined) line += `\n    ✅ ~${Math.round(w.atReset)}% at reset${w.resetsAt ? ` (${clock(Date.parse(w.resetsAt))})` : ""}`;
    }
    lines.push(line);
  }
  if (!forecast.calibrated) lines.push("", "Per-session plan percentages appear once a few plan readings have been calibrated (install the hooks to collect them).");
  return lines.join("\n");
}
