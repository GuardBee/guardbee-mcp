import type { ScanResult } from "./injection.js";

/**
 * A model that scores how likely a text is a prompt injection or jailbreak
 * (0–1). `@guardbee/injection-model` implements it in-process; the proxy
 * also has a sidecar client. The rules stay authoritative: the score can only
 * add a warning or a block, never clear a rule's block.
 */
export interface InjectionClassifier {
  /** Model id and revision, for audit events and SARIF. */
  readonly model: string;
  /** One score per text, in order. */
  classify(texts: readonly string[]): Promise<number[]>;
}

export interface ClassifierThresholds {
  /** At or above: warn (logged, the call goes through). */
  warnAt: number;
  /** At or above: block in block mode, warn in warn mode. */
  blockAt: number;
}

export const DEFAULT_CLASSIFIER_THRESHOLDS: ClassifierThresholds = { warnAt: 0.5, blockAt: 0.9 };

/** What the classifier adds to the rules' result for one score. */
export function combineWithClassifier(rules: ScanResult, score: number, thresholds: ClassifierThresholds, mode: "block" | "warn", model: string): ScanResult {
  if (rules.action === "block") return rules;
  const pct = `${(score * 100).toFixed(0)}%`;
  if (score >= thresholds.blockAt) return { action: mode, reason: `Prompt injection classifier (${model}): ${pct} likely an injection` };
  if (score >= thresholds.warnAt && rules.action === "allow") return { action: "warn", reason: `Possible prompt injection, classifier (${model}): ${pct} (not blocked)` };
  return rules;
}
