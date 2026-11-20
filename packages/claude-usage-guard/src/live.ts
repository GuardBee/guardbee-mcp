import { statSync } from "fs";
import type { ClaudePaths } from "./paths.js";
import { readSnapshots, recordSnapshot, type UsageSnapshot } from "./snapshots.js";

interface RateLimitWindow {
  used_percentage?: unknown;
  resets_at?: unknown;
}

// An unchanged meter is still worth a reading now and then: it shows the account was quiet
const MIN_GAP_MS = 10 * 60_000;
// The status line also runs on timers and mode changes; only a fresh API response carries a fresh meter
const FRESH_MS = 60_000;

function windowOf(value: unknown): { utilization: number; resetsAt?: string } | undefined {
  const w = value as RateLimitWindow | undefined;
  if (!w || typeof w.used_percentage !== "number") return undefined;
  // Epoch seconds in the status line input
  const resetsAt = typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : undefined;
  return { utilization: w.used_percentage, resetsAt };
}

/**
 * The plan meters Claude Code passes its status line (`rate_limits`), from the latest API response,
 * as a snapshot. They count every client on the account, like the cached /usage reading, but
 * arrive with every message instead of once per startup.
 */
export function snapshotFromRateLimits(rateLimits: unknown, at: number): UsageSnapshot | undefined {
  if (!rateLimits || typeof rateLimits !== "object") return undefined;
  const r = rateLimits as Record<string, unknown>;
  const five = windowOf(r.five_hour);
  const seven = windowOf(r.seven_day);
  if (!five && !seven) return undefined;
  return { at, fiveHour: five?.utilization, fiveHourResetsAt: five?.resetsAt, sevenDay: seven?.utilization, sevenDayResetsAt: seven?.resetsAt };
}

function sameMeters(a: UsageSnapshot, b: UsageSnapshot): boolean {
  return a.fiveHour === b.fiveHour && a.sevenDay === b.sevenDay;
}

/**
 * Stores the status line's plan reading when it came with a fresh response (the transcript was just
 * written) and either the meters moved or the last reading is getting old. Returns whether it stored.
 */
export function recordLiveReading(
  input: Record<string, unknown>,
  options: { paths?: Partial<ClaudePaths>; now?: number } = {}
): boolean {
  const now = options.now ?? Date.now();
  const snapshot = snapshotFromRateLimits(input.rate_limits, now);
  if (!snapshot) return false;
  if (typeof input.transcript_path === "string") {
    try {
      if (now - statSync(input.transcript_path).mtimeMs > FRESH_MS) return false;
    } catch {
      return false;
    }
  }
  const last = readSnapshots(options.paths).at(-1);
  if (last && sameMeters(last, snapshot) && now - last.at < MIN_GAP_MS) return false;
  return recordSnapshot(snapshot, options.paths);
}
