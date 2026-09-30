import type { Label } from "./labels.js";

export type PolicyAction = "allow" | "deny" | "mask" | "warn" | "approve";

export type ArgMatcher = string | number | boolean;

export interface PolicyRule {
  id?: string;
  match: {
    /** Glob on the tool name the agent sees (`*` any run, `?` one character). */
    tool?: string;
    upstream?: string;
    label?: Label;
    session?: "clean" | "tainted";
    /** Dotted path into the call arguments → expected value; strings are globs. */
    args?: Record<string, ArgMatcher>;
  };
  action: PolicyAction;
  /** For `mask`: also blank these JSON keys in the result (case-insensitive). */
  mask?: { fields: string[] };
}

export interface PolicyContext {
  tool: string;
  upstream: string;
  labels: readonly Label[];
  tainted: boolean;
  args?: Record<string, unknown>;
}

export interface PolicyDecision {
  action: PolicyAction;
  /** The rule's `id`, or `rules[<index>]`; absent when the default applied. */
  ruleId?: string;
  maskFields?: string[];
}

export function globToRegExp(glob: string): RegExp {
  const source = glob
    .split("")
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`);
}

function valueAt(root: unknown, dotted: string): unknown {
  let current = root;
  for (const key of dotted.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function argMatches(actual: unknown, expected: ArgMatcher): boolean {
  if (typeof expected === "string") {
    return (typeof actual === "string" || typeof actual === "number") && globToRegExp(expected).test(String(actual));
  }
  return actual === expected;
}

function matches(rule: PolicyRule, ctx: PolicyContext): boolean {
  const { tool, upstream, label, session, args } = rule.match;
  if (tool !== undefined && !globToRegExp(tool).test(ctx.tool)) return false;
  if (upstream !== undefined && upstream !== ctx.upstream) return false;
  if (label !== undefined && !ctx.labels.includes(label)) return false;
  if (session !== undefined && (session === "tainted") !== ctx.tainted) return false;
  if (args !== undefined) {
    for (const [dotted, expected] of Object.entries(args)) {
      if (!argMatches(valueAt(ctx.args, dotted), expected)) return false;
    }
  }
  return true;
}

/** Rules are checked top to bottom; the first match wins. No match → `defaultAction`. */
export function evaluatePolicy(
  rules: readonly PolicyRule[],
  defaultAction: PolicyAction,
  ctx: PolicyContext,
): PolicyDecision {
  for (const [index, rule] of rules.entries()) {
    if (matches(rule, ctx)) {
      const decision: PolicyDecision = { action: rule.action, ruleId: rule.id ?? `rules[${index}]` };
      if (rule.mask) decision.maskFields = rule.mask.fields;
      return decision;
    }
  }
  return { action: defaultAction };
}
