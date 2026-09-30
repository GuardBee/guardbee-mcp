import { INJECTION_RULES, type InjectionRule } from "@guardbee/guard-core";

// The rule list lives in @guardbee/guard-core, shared with the runtime proxy.
// This scanner reports to a person reading a file, so it keeps to the precise
// rules: broad ones ("act as", "developer mode") are too common in ordinary text.
export type { InjectionCategory } from "@guardbee/guard-core";
export type InjectionPattern = InjectionRule;

export const INJECTION_PATTERNS: InjectionPattern[] = INJECTION_RULES.filter((rule) => !rule.broad);
