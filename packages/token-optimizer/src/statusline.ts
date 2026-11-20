import {
  compact,
  forecastWindow,
  installStatusLine,
  readAlarmState,
  readPlanUtilization,
  readSnapshots,
  recordLiveReading,
  resolvePaths,
  selfCommand,
  snapshotFromRateLimits,
  toPlanPct,
  weightedTokens,
  type ClaudePaths,
  type HookInstallResult,
} from "@guardbee/mcp-claude-usage-guard";
import { join } from "path";
import { CONTEXT_HOOK_TAG, DEFAULT_THRESHOLD, PACKAGE_NAME, lastMainCall, type Lang } from "./context-hook.js";

export const STATUSLINE_TAG = `${CONTEXT_HOOK_TAG}:statusline`;

// Show the alarm marker this long after the alarm fired
const ALARM_MS = 12 * 3_600_000;

interface Meter {
  utilization: number;
  resetsAt?: string;
}

const COLORS = { green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m", reset: "\x1b[0m" };

function paint(text: string, color: keyof typeof COLORS, enabled: boolean): string {
  return enabled ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

function level(value: number, warn: number, high: number): keyof typeof COLORS {
  return value >= high ? "red" : value >= warn ? "yellow" : "green";
}

function countdown(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined;
  const minutes = Math.round((Date.parse(resetsAt) - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.round(minutes / 1440)}d`;
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function contextOf(input: Record<string, unknown>): number | undefined {
  const window = input.context_window as { current_usage?: Record<string, number> | null } | undefined;
  const u = window?.current_usage;
  if (u && typeof u === "object") return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  if (typeof input.transcript_path === "string") return lastMainCall(input.transcript_path)?.context;
  return undefined;
}

export interface StatusLineOptions {
  paths?: Partial<ClaudePaths>;
  lang?: Lang;
  color?: boolean;
  threshold?: number;
  now?: number;
  /** Store the plan reading for the usage guard (default true) */
  record?: boolean;
}

/**
 * One line for Claude Code's status line: context size, the plan meters with time to reset, the
 * plan cost of the next message, a warning when the pace hits the limit before the reset, and the
 * foreign-usage alarm. Stores each fresh plan reading, which is what makes the alarm timely.
 */
export function statusLine(input: Record<string, unknown>, options: StatusLineOptions = {}): string {
  const now = options.now ?? Date.now();
  const color = options.color ?? true;
  const tr = options.lang === "tr";
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const sep = paint(" · ", "dim", color);
  const parts: string[] = [];

  if (options.record !== false) {
    try {
      recordLiveReading(input, { paths: options.paths, now });
    } catch {
      // the status line must render even if the state dir is not writable
    }
  }

  const model = input.model as { id?: string; display_name?: string } | undefined;
  if (model?.display_name) parts.push(model.display_name);

  const context = contextOf(input);
  const alarmState = readAlarmState(options.paths);
  const tokensPerPct = alarmState.tokensPerPct ?? {};
  if (context !== undefined && context > 0) {
    const size = (input.context_window as { context_window_size?: number } | undefined)?.context_window_size;
    // Window sizes are round numbers: "1M", not "1.0M"
    const sizeText = size && size % 1_000_000 === 0 ? `${size / 1_000_000}M` : size ? compact(size) : "";
    let text = `ctx ${compact(context)}${sizeText ? `/${sizeText}` : ""}`;
    const perMessage = toPlanPct(weightedTokens({ input: 0, output: 0, cacheWrite: 0, cacheRead: context, model: model?.id ?? "unknown" }), "five_hour", { tokensPerPct });
    if (perMessage !== undefined && perMessage >= 0.1) text += tr ? ` (~%${perMessage.toFixed(1)}/mesaj)` : ` (~${perMessage.toFixed(1)}%/msg)`;
    parts.push(paint(text, level(context, threshold, threshold * 2), color));
  }

  // Live meters from the latest response; else Claude Code's cached /usage reading if still current
  let five: Meter | undefined;
  let seven: Meter | undefined;
  const live = snapshotFromRateLimits(input.rate_limits, now);
  if (live) {
    if (live.fiveHour !== undefined) five = { utilization: live.fiveHour, resetsAt: live.fiveHourResetsAt };
    if (live.sevenDay !== undefined) seven = { utilization: live.sevenDay, resetsAt: live.sevenDayResetsAt };
  } else {
    const cached = readPlanUtilization(options.paths);
    const current = (w?: Meter) => (w && (!w.resetsAt || Date.parse(w.resetsAt) > now) ? w : undefined);
    five = current(cached?.fiveHour);
    seven = current(cached?.sevenDay);
  }
  if (five) {
    const left = countdown(five.resetsAt, now);
    let text = `5h ${Math.round(five.utilization)}%${left ? ` ↻${left}` : ""}`;
    const forecast = forecastWindow("five_hour", five, now, { tokensPerPct, snapshots: readSnapshots(options.paths), usage: [] }, now);
    if (forecast.limitAt) text += tr ? ` → %100 ${clockTime(forecast.limitAt)}` : ` → 100% at ${clockTime(forecast.limitAt)}`;
    parts.push(paint(text, forecast.limitAt ? "red" : level(five.utilization, 60, 85), color));
  }
  if (seven) parts.push(paint(`7d ${Math.round(seven.utilization)}%`, level(seven.utilization, 60, 85), color));

  const alarm = alarmState.lastAlert;
  if (alarm && now - alarm.at < ALARM_MS) parts.push(paint(tr ? "🚨 dış kullanım: detect" : "🚨 foreign usage: detect", "red", color));

  return parts.join(sep);
}

export function installStatusLineCommand(options: {
  paths?: Partial<ClaudePaths>;
  apply?: boolean;
  force?: boolean;
  scriptPath?: string;
  version: string;
  lang?: Lang;
  threshold?: number;
}): HookInstallResult {
  const flags = [options.threshold ? `--threshold ${options.threshold}` : "", options.lang && options.lang !== "en" ? `--lang ${options.lang}` : ""].filter(Boolean).join(" ");
  const command = `${selfCommand(options.scriptPath, PACKAGE_NAME, options.version)} statusline${flags ? ` ${flags}` : ""}`;
  return installStatusLine({ command, padding: 0 }, STATUSLINE_TAG, {
    paths: options.paths,
    apply: options.apply,
    force: options.force,
    backupDir: join(resolvePaths(options.paths).stateDir, "..", "token-optimizer", "backups"),
  });
}
