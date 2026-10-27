import type { Label } from "./labels.js";
import { globToRegExp } from "./policy.js";
import { CountersUnavailableError, MemoryCounters, type CounterBackend, type WindowCount } from "../state/counters.js";

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
 * Quota counters. In memory (default) they cover every session of one gateway
 * process; with `state.backend: redis` every replica counts against the same
 * numbers (see state/counters.ts).
 */
export class QuotaStore {
  constructor(
    private readonly now: () => number = Date.now,
    private readonly counters: CounterBackend = new MemoryCounters(now),
  ) {}

  /**
   * Check every matching rule; when all have room, count the call against
   * each and return null. Otherwise count nothing and say which rule is full.
   */
  async take(rules: readonly QuotaRule[], caller: QuotaCaller): Promise<QuotaRefusal | null> {
    const at = this.now();
    const hits: { ruleId: string; rule: QuotaRule; windowStart: number; count: WindowCount }[] = [];
    for (const [index, rule] of rules.entries()) {
      if (!matches(rule, caller)) continue;
      const ruleId = rule.id ?? `quotas[${index}]`;
      const who =
        rule.per === "gateway" ? "*" : rule.per === "session" ? `s:${caller.sessionId ?? "local"}` : caller.user ? `u:${caller.user}` : `s:${caller.sessionId ?? "local"}`;
      const windowMs = rule.windowSeconds * 1000;
      const windowStart = Math.floor(at / windowMs) * windowMs;
      // The window start is part of the key: a new window is a new counter
      hits.push({ ruleId, rule, windowStart, count: { key: `quota:${ruleId}:${who}:${windowStart}`, limit: rule.limit, ttlMs: windowStart + windowMs - at + 1000 } });
    }
    if (hits.length === 0) return null;
    let full: number;
    try {
      full = await this.counters.take(hits.map((h) => h.count));
    } catch (err) {
      if (!(err instanceof CountersUnavailableError)) throw err;
      return { ruleId: "state:unavailable", retryAfter: 5, reason: `quota not checked: ${err.message} (state.onError: fail-closed)` };
    }
    if (full === -1) return null;
    const { ruleId, rule, windowStart } = hits[full]!;
    const retryAfter = Math.max(1, Math.ceil((windowStart + rule.windowSeconds * 1000 - at) / 1000));
    const scope = rule.per === "gateway" ? "this gateway" : rule.per === "session" ? "this session" : caller.user ? `user "${caller.user}"` : "this session";
    return { ruleId, retryAfter, reason: `quota ${ruleId} reached: ${rule.limit} calls per ${rule.windowSeconds}s for ${scope}; try again in ${retryAfter}s` };
  }
}
