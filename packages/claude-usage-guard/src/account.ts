import { readFileSync } from "fs";
import { resolvePaths, type ClaudePaths } from "./paths.js";

export interface AccountInfo {
  accountUuid?: string;
  email?: string;
  displayName?: string;
  organizationName?: string;
  organizationRole?: string;
  billingType?: string;
  rateLimitTier?: string;
}

export interface PlanWindow {
  /** Percent of the window's limit used, 0-100 */
  utilization: number;
  resetsAt?: string;
}

/**
 * Plan usage for the whole account, as Claude Code last fetched it. This counts every client
 * signed in to the account (other machines, claude.ai, the mobile and desktop apps), unlike
 * the transcripts, which only hold this machine's Claude Code calls.
 */
export interface PlanUtilization {
  fetchedAt: number;
  accountUuid?: string;
  fiveHour?: PlanWindow;
  sevenDay?: PlanWindow;
}

export function readClaudeJson(paths?: Partial<ClaudePaths>): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(resolvePaths(paths).claudeJson, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function readAccount(paths?: Partial<ClaudePaths>): AccountInfo | undefined {
  const account = readClaudeJson(paths)?.oauthAccount as Record<string, unknown> | undefined;
  if (!account || typeof account !== "object") return undefined;
  const str = (k: string) => (typeof account[k] === "string" ? (account[k] as string) : undefined);
  return {
    accountUuid: str("accountUuid"),
    email: str("emailAddress"),
    displayName: str("displayName"),
    organizationName: str("organizationName"),
    organizationRole: str("organizationRole"),
    billingType: str("billingType"),
    rateLimitTier: str("userRateLimitTier") ?? str("organizationRateLimitTier"),
  };
}

function planWindow(value: unknown): PlanWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const w = value as Record<string, unknown>;
  if (typeof w.utilization !== "number") return undefined;
  return { utilization: w.utilization, resetsAt: typeof w.resets_at === "string" ? w.resets_at : undefined };
}

/**
 * Claude Code caches the plan usage it shows in /usage under `cachedUsageUtilization`. The field
 * is internal and undocumented, so a missing or reshaped value yields undefined, not an error.
 */
export function readPlanUtilization(paths?: Partial<ClaudePaths>): PlanUtilization | undefined {
  const cached = readClaudeJson(paths)?.cachedUsageUtilization as Record<string, unknown> | undefined;
  if (!cached || typeof cached !== "object" || typeof cached.fetchedAtMs !== "number") return undefined;
  const util = (cached.utilization ?? {}) as Record<string, unknown>;
  const result: PlanUtilization = {
    fetchedAt: cached.fetchedAtMs,
    accountUuid: typeof cached.accountUuid === "string" ? cached.accountUuid : undefined,
    fiveHour: planWindow(util.five_hour),
    sevenDay: planWindow(util.seven_day),
  };
  return result.fiveHour || result.sevenDay ? result : undefined;
}
