import { Judge, stringsIn } from "@guardbee/guard-core";
import type { AuditEvent } from "../types.js";
import type { GatewayJudgeConfig } from "./config.js";

/**
 * The LLM judge's second opinion on a borderline injection finding: the
 * rules said `warn`, the judge reads the text and may raise it to the
 * configured action (`block`), keep it, or — only with mayClear — clear it.
 * It never sees what the rules already blocked or allowed, so it can only
 * move a decision the rules left open. A judge that fails or misses the
 * latency budget leaves the warning (onError: open) or blocks (closed).
 */

const judges = new WeakMap<GatewayJudgeConfig, Judge>();

/** One judge (and one verdict cache) per config, shared by the sessions that use it. */
export function judgeFor(config: GatewayJudgeConfig | undefined, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>): Judge | undefined {
  if (!config) return undefined;
  let judge = judges.get(config);
  if (!judge) {
    judge = new Judge(
      { endpoint: config.endpoint, model: config.model, ...(config.apiKey ? { apiKey: config.apiKey } : {}), allowRemote: config.allowRemote, timeoutMs: config.budgetMs, cacheSize: config.cacheSize },
      fetchImpl ? { fetch: fetchImpl } : {},
    );
    judges.set(config, judge);
  }
  return judge;
}

export interface SecondOpinion {
  action: "block" | "warn" | "allow";
  reason: string;
  judge: NonNullable<AuditEvent["judge"]>;
}

export async function secondOpinion(
  config: GatewayJudgeConfig,
  judge: Judge,
  input: unknown,
  where: "tool argument" | "tool result",
  ruleReason: string,
  mode: "block" | "warn",
  /** What the rules decided: warn (borderline), or allow (judge.scope: results) — then only a confident "malicious" changes anything. */
  rules: "warn" | "allow" = "warn",
): Promise<SecondOpinion> {
  const text = stringsIn(input).join("\n");
  try {
    const verdict = await judge.classifyInjection(text, { where, timeoutMs: config.budgetMs });
    const seen = { model: verdict.model.name, ...(verdict.model.version ? { version: verdict.model.version } : {}), verdict: verdict.verdict, confidence: verdict.confidence, latencyMs: verdict.latencyMs, cached: verdict.cached };
    const sure = verdict.confidence >= config.minConfidence;
    const said = `judge ${judge.describe(verdict.model)}: ${verdict.verdict} (${verdict.confidence.toFixed(2)})${verdict.reason ? `, ${verdict.reason}` : ""}`;
    if (verdict.verdict === "malicious" && sure) return { action: mode, reason: `${ruleReason}; ${rules === "allow" ? "found" : "confirmed"} by ${said}`, judge: { ...seen, outcome: mode === "block" || rules === "allow" ? "raised" : "kept" } };
    if (rules === "allow") return { action: "allow", reason: ruleReason, judge: { ...seen, outcome: "kept" } };
    if (verdict.verdict === "benign" && sure && config.mayClear) return { action: "allow", reason: `${ruleReason}; cleared by ${said}`, judge: { ...seen, outcome: "cleared" } };
    return { action: "warn", reason: `${ruleReason}; ${said}`, judge: { ...seen, outcome: "kept" } };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // onError applies to borderline findings; a result the rules let through stays allowed
    const closed = config.onError === "closed" && rules === "warn";
    return {
      action: closed ? "block" : rules === "allow" ? "allow" : "warn",
      reason: `${ruleReason}; judge unavailable (${error})${closed ? ", blocked (judge.onError: closed)" : ""}`,
      judge: { model: config.model, error, outcome: closed ? "failed-closed" : "failed-open" },
    };
  }
}
