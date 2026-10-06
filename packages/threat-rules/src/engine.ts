import {
  ATREngine,
  type AgentEvent,
  type AgentEventType,
  type ATRMatch,
  type ATRSeverity,
} from "agent-threat-rules";

export type Lane = "enforce" | "alert" | "hunt";

export interface EvaluateResult {
  matchCount: number;
  highestSeverity: ATRSeverity | null;
  durationMs: number;
  matches: Array<{
    ruleId: string;
    title: string;
    severity: ATRSeverity;
    category: string;
    confidence: number;
    matchedPatterns: string[];
    owaspLlm?: string[];
    owaspAgentic?: string[];
    guardbeeHint: string;
  }>;
}

/** Map ATR categories onto GuardBee static scanners for follow-up. */
export const GUARDBEE_CATEGORY_HINTS: Record<string, string> = {
  "prompt-injection":
    "Follow up with @guardbee/mcp-prompt-injection-scanner on untrusted content sources.",
  "tool-poisoning":
    "Follow up with @guardbee/mcp-tool-poisoning-scanner on MCP tool descriptions/handlers.",
  "context-exfiltration":
    "Follow up with @guardbee/mcp-toxic-flow-auditor (lethal trifecta) and @guardbee/mcp-prompt-leak-scanner.",
  "agent-manipulation":
    "Follow up with @guardbee/mcp-memory-poisoning-scanner and @guardbee/mcp-agent-graph-auditor.",
  "privilege-escalation":
    "Follow up with @guardbee/mcp-oauth-auditor and @guardbee/mcp-server-auditor (excessive agency).",
  "excessive-autonomy":
    "Follow up with @guardbee/mcp-unbounded-consumption-auditor and @guardbee/mcp-agent-graph-auditor.",
  "data-poisoning":
    "Follow up with @guardbee/mcp-vector-store-scanner and @guardbee/mcp-memory-poisoning-scanner.",
  "model-abuse": "Follow up with @guardbee/mcp-llm-redteam against the live model endpoint.",
  "skill-compromise":
    "Follow up with @guardbee/mcp-slopsquat-scanner and @guardbee/mcp-dependency-auditor.",
};

let cached: { lane: Lane; engine: ATREngine } | null = null;

export async function getEngine(lane: Lane = "hunt"): Promise<ATREngine> {
  if (cached && cached.lane === lane) return cached.engine;
  // ATREngine.findBundledRulesDir() locates the npm package's rules/ folder.
  const engine = new ATREngine({ lane });
  const count = await engine.loadRules();
  if (count === 0) {
    throw new Error("ATREngine loaded 0 rules — agent-threat-rules install looks broken");
  }
  cached = { lane, engine };
  return engine;
}

/** Reset cached engine — for tests when lane changes. */
export function resetEngineCache(): void {
  cached = null;
}

function formatMatch(match: ATRMatch) {
  const category = match.rule.tags?.category ?? "unknown";
  return {
    ruleId: match.rule.id,
    title: match.rule.title,
    severity: match.rule.severity,
    category,
    confidence: match.confidence,
    matchedPatterns: [...match.matchedPatterns],
    owaspLlm: match.rule.references?.owasp_llm,
    owaspAgentic: match.rule.references?.owasp_agentic,
    guardbeeHint: GUARDBEE_CATEGORY_HINTS[category] ?? "Review with GuardBee MCP auditors.",
  };
}

function severityRank(sev: ATRSeverity | null | undefined): number {
  const order: ATRSeverity[] = ["critical", "high", "medium", "low", "informational"];
  if (!sev) return 99;
  const idx = order.indexOf(sev);
  return idx === -1 ? 99 : idx;
}

export function evaluateEvent(engine: ATREngine, event: AgentEvent): EvaluateResult {
  const start = Date.now();
  const matches = engine.evaluate(event);
  let highestSeverity: ATRSeverity | null = null;
  for (const m of matches) {
    if (severityRank(m.rule.severity) < severityRank(highestSeverity)) {
      highestSeverity = m.rule.severity;
    }
  }
  return {
    matchCount: matches.length,
    highestSeverity,
    durationMs: Date.now() - start,
    matches: matches.map(formatMatch),
  };
}

export function buildEvent(input: {
  type?: AgentEventType;
  content: string;
  fields?: Record<string, string>;
  sessionId?: string;
  agentId?: string;
  scanContext?: "mcp" | "skill";
}): AgentEvent {
  return {
    type: input.type ?? "llm_input",
    timestamp: new Date().toISOString(),
    content: input.content,
    fields: input.fields,
    sessionId: input.sessionId,
    agentId: input.agentId,
    scanContext: input.scanContext,
  };
}

export function listLoadedRules(engine: ATREngine, category?: string) {
  const list = engine.getRules();
  const filtered = category
    ? list.filter((r) => (r.tags?.category ?? "") === category)
    : [...list];
  return filtered.map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    category: r.tags?.category ?? "unknown",
    status: r.status ?? "unknown",
  }));
}
