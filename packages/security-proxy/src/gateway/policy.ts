import type { Label } from "./labels.js";

export type PolicyAction = "allow" | "deny" | "mask" | "warn";

export interface PolicyRule {
  id?: string;
  match: {
    /** Glob on the tool name the agent sees (`*` any run, `?` one character). */
    tool?: string;
    upstream?: string;
    label?: Label;
    session?: "clean" | "tainted";
  };
  action: PolicyAction;
}

export interface PolicyContext {
  tool: string;
  upstream: string;
  labels: readonly Label[];
  tainted: boolean;
}

export interface PolicyDecision {
  action: PolicyAction;
  /** The rule's `id`, or `rules[<index>]`; absent when the default applied. */
  ruleId?: string;
}

export function globToRegExp(glob: string): RegExp {
  const source = glob
    .split("")
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`);
}

function matches(rule: PolicyRule, ctx: PolicyContext): boolean {
  const { tool, upstream, label, session } = rule.match;
  if (tool !== undefined && !globToRegExp(tool).test(ctx.tool)) return false;
  if (upstream !== undefined && upstream !== ctx.upstream) return false;
  if (label !== undefined && !ctx.labels.includes(label)) return false;
  if (session !== undefined && (session === "tainted") !== ctx.tainted) return false;
  return true;
}

/** Rules are checked top to bottom; the first match wins. No match → `defaultAction`. */
export function evaluatePolicy(
  rules: readonly PolicyRule[],
  defaultAction: PolicyAction,
  ctx: PolicyContext,
): PolicyDecision {
  for (const [index, rule] of rules.entries()) {
    if (matches(rule, ctx)) return { action: rule.action, ruleId: rule.id ?? `rules[${index}]` };
  }
  return { action: defaultAction };
}
