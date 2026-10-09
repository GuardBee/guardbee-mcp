import type { Label } from "./labels.js";
import { globToRegExp } from "./policy.js";

/**
 * A cap on tool calls over a fixed window, counted across sessions. Unlike
 * interceptors.anomaly (one session's behaviour), a quota holds when a user
 * opens ten sessions, or when all agents share one upstream budget.
 */
export interface QuotaRule {
  id?: string;
  /** All given fields must match (tool and user are globs; group is one of the caller's groups). */
  match: { tool?: string; upstream?: string; label?: Label; user?: string; group?: string };
  limit: number;
  windowSeconds: number;
  /** Who shares a counter: each user (else each session), each session, or the whole gateway. */
  per: "user" | "session" | "gateway";
}

export interface QuotaCaller {
  tool: string;
  upstream: string;
  labels: readonly Label[];
  sessionId?: string;
  user?: string;
  groups?: readonly string[];
}

export interface QuotaRefusal {
  ruleId: string;
  reason: string;
  /** Seconds until the window resets. */
  retryAfter: number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

const MAX_BUCKETS = 50_000;

function matches(rule: QuotaRule, caller: QuotaCaller): boolean {
  const { tool, upstream, label, user, group } = rule.match;
  if (tool !== undefined && !globToRegExp(tool).test(caller.tool)) return false;
  if (upstream !== undefined && upstream !== caller.upstream) return false;
  if (label !== undefined && !caller.labels.includes(label)) return false;
  if (user !== undefined && (caller.user === undefined || !globToRegExp(user).test(caller.user))) return false;
  if (group !== undefined && !(caller.groups ?? []).includes(group)) return false;
  return true;
}

/**
 * Counters for every session of one gateway process. Over HTTP one store is
 * shared by all sessions; several proxy replicas each keep their own.
 */
export class QuotaStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Check every matching rule; when all have room, count the call against
   * each and return null. Otherwise count nothing and say which rule is full.
   */
  take(rules: readonly QuotaRule[], caller: QuotaCaller): QuotaRefusal | null {
    const at = this.now();
    const hits: { key: string; bucket: Bucket }[] = [];
    for (const [index, rule] of rules.entries()) {
      if (!matches(rule, caller)) continue;
      const ruleId = rule.id ?? `quotas[${index}]`;
      const who =
        rule.per === "gateway" ? "*" : rule.per === "session" ? `s:${caller.sessionId ?? "local"}` : caller.user ? `u:${caller.user}` : `s:${caller.sessionId ?? "local"}`;
      const key = `${ruleId}\0${who}`;
      const windowMs = rule.windowSeconds * 1000;
      const windowStart = Math.floor(at / windowMs) * windowMs;
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.windowStart !== windowStart) bucket = { windowStart, count: 0 };
      if (bucket.count >= rule.limit) {
        const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - at) / 1000));
        const scope = rule.per === "gateway" ? "this gateway" : rule.per === "session" ? "this session" : caller.user ? `user "${caller.user}"` : "this session";
        return {
          ruleId,
          retryAfter,
          reason: `quota ${ruleId} reached: ${rule.limit} calls per ${rule.windowSeconds}s for ${scope}; try again in ${retryAfter}s`,
        };
      }
      hits.push({ key, bucket });
    }
    for (const { key, bucket } of hits) {
      bucket.count++;
      this.buckets.set(key, bucket);
    }
    if (this.buckets.size > MAX_BUCKETS) this.prune(at, rules);
    return null;
  }

  /** Drop buckets whose window has passed. */
  private prune(at: number, rules: readonly QuotaRule[]): void {
    const longest = Math.max(...rules.map((rule) => rule.windowSeconds), 0) * 1000;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart + longest <= at) this.buckets.delete(key);
    }
  }
}
