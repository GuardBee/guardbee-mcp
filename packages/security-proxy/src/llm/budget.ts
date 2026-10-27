import { globToRegExp } from "../gateway/policy.js";
import type { LlmBudget, LlmPrice } from "./config.js";
import { CountersUnavailableError, MemoryCounters, type CounterBackend } from "../state/counters.js";

export interface LlmCaller {
  model: string;
  /** Virtual key or OIDC user; absent for a plain listen.apiKeys key. */
  user?: string;
  groups: readonly string[];
  /** Counter for callers without a user (one per key). */
  anonymousId: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BudgetRefusal {
  ruleId: string;
  reason: string;
  retryAfter: number;
}

function matches(budget: LlmBudget, caller: LlmCaller): boolean {
  const { model, user, group } = budget.match;
  if (model !== undefined && !globToRegExp(model).test(caller.model)) return false;
  if (user !== undefined && (caller.user === undefined || !globToRegExp(user).test(caller.user))) return false;
  if (group !== undefined && !caller.groups.includes(group)) return false;
  return true;
}

/** Price of a call; null when no pricing entry covers the model. */
export function costOf(pricing: Record<string, LlmPrice>, model: string, usage: LlmUsage): number | null {
  const price = pricing[model] ?? Object.entries(pricing).find(([glob]) => globToRegExp(glob).test(model))?.[1];
  if (!price) return null;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/**
 * Request, token and spend counters over fixed windows: in memory for one
 * proxy process, or shared by every replica with `state.backend: redis`. A
 * request is admitted while every matching budget still has room; its tokens
 * and cost are only known afterwards, so the call that crosses a limit
 * completes and the next one is refused.
 */
export class BudgetStore {
  constructor(
    private readonly now: () => number = Date.now,
    private readonly counters: CounterBackend = new MemoryCounters(now),
  ) {}

  private bucketsFor(budgets: readonly LlmBudget[], caller: LlmCaller, at: number) {
    const out: { ruleId: string; budget: LlmBudget; key: string; windowStart: number; ttlMs: number }[] = [];
    for (const [index, budget] of budgets.entries()) {
      if (!matches(budget, caller)) continue;
      const ruleId = budget.id ?? `llm.budgets[${index}]`;
      const who = budget.per === "gateway" ? "*" : caller.user ? `u:${caller.user}` : `k:${caller.anonymousId}`;
      const windowMs = budget.windowSeconds * 1000;
      const windowStart = Math.floor(at / windowMs) * windowMs;
      out.push({ ruleId, budget, key: `budget:${ruleId}:${who}:${windowStart}`, windowStart, ttlMs: windowStart + windowMs - at + 1000 });
    }
    return out;
  }

  /** Admit and count one request, or say which budget is used up. */
  async admit(budgets: readonly LlmBudget[], caller: LlmCaller): Promise<BudgetRefusal | null> {
    const at = this.now();
    const buckets = this.bucketsFor(budgets, caller, at);
    if (buckets.length === 0) return null;
    let full: Awaited<ReturnType<CounterBackend["admit"]>>;
    try {
      full = await this.counters.admit(
        buckets.map(({ key, ttlMs, budget }) => ({
          key,
          ttlMs,
          limits: {
            ...(budget.requests !== undefined ? { requests: budget.requests } : {}),
            ...(budget.tokens !== undefined ? { tokens: budget.tokens } : {}),
            ...(budget.costUsd !== undefined ? { costUsd: budget.costUsd } : {}),
          },
        })),
      );
    } catch (err) {
      if (!(err instanceof CountersUnavailableError)) throw err;
      return { ruleId: "state:unavailable", retryAfter: 5, reason: `budget not checked: ${err.message} (state.onError: fail-closed)` };
    }
    if (!full) return null;
    const { ruleId, budget, windowStart } = buckets[full.index]!;
    const what = full.full === "requests" ? `${budget.requests} requests` : full.full === "tokens" ? `${budget.tokens} tokens` : `$${budget.costUsd}`;
    const retryAfter = Math.max(1, Math.ceil((windowStart + budget.windowSeconds * 1000 - at) / 1000));
    const scope = budget.per === "gateway" ? "this gateway" : caller.user ? `user "${caller.user}"` : "this key";
    return { ruleId, retryAfter, reason: `budget ${ruleId} reached: ${what} per ${budget.windowSeconds}s for ${scope}; try again in ${retryAfter}s` };
  }

  /** Add what a finished request used. */
  async record(budgets: readonly LlmBudget[], caller: LlmCaller, usage: LlmUsage, costUsd: number | null): Promise<void> {
    const buckets = this.bucketsFor(budgets, caller, this.now());
    await this.counters.add(buckets.map(({ key, ttlMs }) => ({ key, ttlMs, tokens: usage.inputTokens + usage.outputTokens, costUsd: costUsd ?? 0 })));
  }
}
