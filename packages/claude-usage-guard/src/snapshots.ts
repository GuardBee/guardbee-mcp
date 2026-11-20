import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import type { PlanUtilization } from "./account.js";
import { resolvePaths, type ClaudePaths } from "./paths.js";

/** Plan utilization at one moment; a series of these is what foreign-usage detection compares. */
export interface UsageSnapshot {
  at: number;
  accountUuid?: string;
  fiveHour?: number;
  fiveHourResetsAt?: string;
  sevenDay?: number;
  sevenDayResetsAt?: string;
}

// Readings from the status line and from Claude Code's cache spell reset times differently
const RESET_TOLERANCE_MS = 10 * 60_000;

/** Whether two readings' reset times name the same limit window. */
export function sameReset(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) < RESET_TOLERANCE_MS;
}

export function snapshotFile(paths?: Partial<ClaudePaths>): string {
  return join(resolvePaths(paths).stateDir, "snapshots.jsonl");
}

export function toSnapshot(plan: PlanUtilization): UsageSnapshot {
  return {
    at: plan.fetchedAt,
    accountUuid: plan.accountUuid,
    fiveHour: plan.fiveHour?.utilization,
    fiveHourResetsAt: plan.fiveHour?.resetsAt,
    sevenDay: plan.sevenDay?.utilization,
    sevenDayResetsAt: plan.sevenDay?.resetsAt,
  };
}

export function readSnapshots(paths?: Partial<ClaudePaths>): UsageSnapshot[] {
  let text: string;
  try {
    text = readFileSync(snapshotFile(paths), "utf8");
  } catch {
    return [];
  }
  const byTime = new Map<number, UsageSnapshot>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const s = JSON.parse(line) as UsageSnapshot;
      if (typeof s.at === "number") byTime.set(s.at, s);
    } catch {
      // a torn last line from an interrupted write
    }
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at);
}

/**
 * Appends `snapshot` unless one with the same fetch time is already stored: Claude Code only
 * refreshes its cached utilization now and then, so repeated reads often return the same value.
 */
export function recordSnapshot(snapshot: UsageSnapshot, paths?: Partial<ClaudePaths>): boolean {
  const existing = readSnapshots(paths);
  if (existing.some((s) => s.at === snapshot.at)) return false;
  mkdirSync(resolvePaths(paths).stateDir, { recursive: true });
  appendFileSync(snapshotFile(paths), `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  return true;
}
