/**
 * Where a GuardBee audit event sits in the frameworks a security team reports
 * against: OWASP Top 10 for LLM Applications (2025) and MITRE ATLAS. Events
 * are classified by their ruleId, then by their type and reason, since the
 * proxy logs some refusals (an injection pattern) without a ruleId.
 */

export interface FrameworkRef {
  id: string;
  name: string;
}

export const OWASP_LLM: Record<string, FrameworkRef> = {
  LLM01: { id: "LLM01:2025", name: "Prompt Injection" },
  LLM02: { id: "LLM02:2025", name: "Sensitive Information Disclosure" },
  LLM03: { id: "LLM03:2025", name: "Supply Chain" },
  LLM05: { id: "LLM05:2025", name: "Improper Output Handling" },
  LLM06: { id: "LLM06:2025", name: "Excessive Agency" },
  LLM07: { id: "LLM07:2025", name: "System Prompt Leakage" },
  LLM10: { id: "LLM10:2025", name: "Unbounded Consumption" },
};

export const MITRE_ATLAS: Record<string, FrameworkRef> = {
  "T0051.000": { id: "AML.T0051.000", name: "LLM Prompt Injection: Direct" },
  "T0051.001": { id: "AML.T0051.001", name: "LLM Prompt Injection: Indirect" },
  T0053: { id: "AML.T0053", name: "LLM Plugin Compromise" },
  T0054: { id: "AML.T0054", name: "LLM Jailbreak" },
  T0056: { id: "AML.T0056", name: "LLM Meta Prompt Extraction" },
  T0057: { id: "AML.T0057", name: "LLM Data Leakage" },
  T0010: { id: "AML.T0010", name: "ML Supply Chain Compromise" },
  T0029: { id: "AML.T0029", name: "Denial of ML Service" },
  T0034: { id: "AML.T0034", name: "Cost Harvesting" },
};

export interface ThreatCategory {
  id: string;
  title: string;
  owasp: FrameworkRef[];
  atlas: FrameworkRef[];
}

const cat = (id: string, title: string, owasp: (keyof typeof OWASP_LLM)[], atlas: (keyof typeof MITRE_ATLAS)[]): ThreatCategory => ({
  id,
  title,
  owasp: owasp.map((key) => OWASP_LLM[key]!),
  atlas: atlas.map((key) => MITRE_ATLAS[key]!),
});

export const THREAT_CATEGORIES = {
  directInjection: cat("direct-injection", "Prompt injection in arguments and prompts", ["LLM01"], ["T0051.000", "T0054"]),
  indirectInjection: cat("indirect-injection", "Instructions hidden in tool results, resources and prompts", ["LLM01", "LLM05"], ["T0051.001"]),
  promptLeak: cat("prompt-leak", "Attempts to extract the system prompt", ["LLM07", "LLM01"], ["T0056"]),
  toolPoisoning: cat("tool-poisoning", "Poisoned tool definitions", ["LLM01", "LLM03"], ["T0051.001", "T0053"]),
  rugPull: cat("rug-pull", "Tool definitions changed after approval", ["LLM03"], ["T0010", "T0053"]),
  dataLeak: cat("data-leak", "Sensitive data or credentials on their way out", ["LLM02", "LLM06"], ["T0057"]),
  excessiveAgency: cat("excessive-agency", "Calls refused or held by policy", ["LLM06"], ["T0053"]),
  consumption: cat("consumption", "Bursts, quotas and budgets", ["LLM10"], ["T0029", "T0034"]),
} as const;

export type ThreatCategoryKey = keyof typeof THREAT_CATEGORIES;

/** The fields of an audit event the classification reads. */
export interface ClassifiableEvent {
  type: string;
  ruleId?: string;
  reason?: string;
}

const REFUSALS = new Set(["blocked", "toxic_flow", "warn", "approval"]);

/** Which threat category an audit event belongs to; null for ordinary activity. */
export function classifyEvent(event: ClassifiableEvent): ThreatCategoryKey | null {
  const rule = event.ruleId ?? "";
  const reason = event.reason ?? "";
  if (event.type === "toxic_flow") return "dataLeak";
  if (!REFUSALS.has(event.type)) return null;
  if (/^poisoning:/.test(rule)) return "toolPoisoning";
  if (/rug pull|definition (?:changed|drift)|MCP03/i.test(reason)) return "rugPull";
  if (/system prompt/i.test(reason) && /injection/i.test(reason)) return "promptLeak";
  if (/^(?:result:injection|sampling:injection)$/.test(rule) || /Tool result blocked|tool result|MCP06/i.test(reason)) return "indirectInjection";
  if (rule === "llm:injection" || /prompt injection/i.test(reason)) return "directInjection";
  if (/^(?:egress:credential|llm:credential|documents:pii|sampling:egress|anomaly:sensitive_sweep)$/.test(rule) || /Toxic flow/i.test(reason)) return "dataLeak";
  if (/^(?:anomaly:(?:call_burst|destructive_burst)|quota:)/.test(rule) || /budget .* reached/i.test(reason)) return "consumption";
  if (event.type === "blocked" || event.type === "approval") return "excessiveAgency";
  return null;
}
