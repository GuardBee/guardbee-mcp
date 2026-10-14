import { globToRegExp } from "../gateway/policy.js";
import type { LlmBudget, LlmPrice } from "./config.js";

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

interface Spend {
  windowStart: number;
  requests: number;
  tokens: number;
  costUsd: number;
}

const MAX_BUCKETS = 50_000;

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
 * Request, token and spend counters over fixed windows, shared by every
 * request of one proxy process. A request is admitted while every matching
 * budget still has room; its tokens and cost are only known afterwards, so
 * the call that crosses a limit completes and the next one is refused.
 */
export class BudgetStore {
  private readonly spends = new Map<string, Spend>();

  constructor(private readonly now: () => number = Date.now) {}

  private bucketsFor(budgets: readonly LlmBudget[], caller: LlmCaller, at: number) {
    const out: { ruleId: string; budget: LlmBudget; key: string; windowStart: number; spend: Spend }[] = [];
    for (const [index, budget] of budgets.entries()) {
      if (!matches(budget, caller)) continue;
      const ruleId = budget.id ?? `llm.budgets[${index}]`;
      const who = budget.per === "gateway" ? "*" : caller.user ? `u:${caller.user}` : `k:${caller.anonymousId}`;
      const key = `${ruleId}\0${who}`;
      const windowMs = budget.windowSeconds * 1000;
      const windowStart = Math.floor(at / windowMs) * windowMs;
      const current = this.spends.get(key);
      const spend = current && current.windowStart === windowStart ? current : { windowStart, requests: 0, tokens: 0, costUsd: 0 };
      out.push({ ruleId, budget, key, windowStart, spend });
    }
    return out;
  }

  /** Admit and count one request, or say which budget is used up. */
  admit(budgets: readonly LlmBudget[], caller: LlmCaller): BudgetRefusal | null {
    const at = this.now();
    const buckets = this.bucketsFor(budgets, caller, at);
    for (const { ruleId, budget, windowStart, spend } of buckets) {
      const full =
        budget.requests !== undefined && spend.requests >= budget.requests
          ? `${budget.requests} requests`
          : budget.tokens !== undefined && spend.tokens >= budget.tokens
            ? `${budget.tokens} tokens`
            : budget.costUsd !== undefined && spend.costUsd >= budget.costUsd
              ? `$${budget.costUsd}`
              : null;
      if (full) {
        const retryAfter = Math.max(1, Math.ceil((windowStart + budget.windowSeconds * 1000 - at) / 1000));
        const scope = budget.per === "gateway" ? "this gateway" : caller.user ? `user "${caller.user}"` : "this key";
        return { ruleId, retryAfter, reason: `budget ${ruleId} reached: ${full} per ${budget.windowSeconds}s for ${scope}; try again in ${retryAfter}s` };
      }
    }
    for (const { key, spend } of buckets) {
      spend.requests++;
      this.spends.set(key, spend);
    }
    if (this.spends.size > MAX_BUCKETS) this.prune(at, budgets);
    return null;
  }

  /** Add what a finished request used. */
  record(budgets: readonly LlmBudget[], caller: LlmCaller, usage: LlmUsage, costUsd: number | null): void {
    for (const { key, spend } of this.bucketsFor(budgets, caller, this.now())) {
      spend.tokens += usage.inputTokens + usage.outputTokens;
      spend.costUsd += costUsd ?? 0;
      this.spends.set(key, spend);
    }
  }

  private prune(at: number, budgets: readonly LlmBudget[]): void {
    const longest = Math.max(...budgets.map((b) => b.windowSeconds), 0) * 1000;
    for (const [key, spend] of this.spends) {
      if (spend.windowStart + longest <= at) this.spends.delete(key);
    }
  }
}
