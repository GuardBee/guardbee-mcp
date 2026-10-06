import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import {
  ATREngine,
  type AgentEvent,
  type AgentEventType,
  type ATRMatch,
  type ATRSeverity,
} from "agent-threat-rules";

export type Lane = "enforce" | "alert" | "hunt";

export interface EngineOptions {
  lane?: Lane;
  /** Extra rule directories (merged after ATR bundled + package GuardBee rules). */
  extraRulesDirs?: string[];
}

export interface FormattedMatch {
  ruleId: string;
  title: string;
  severity: ATRSeverity;
  category: string;
  confidence: number;
  matchedPatterns: string[];
  owaspLlm?: string[];
  owaspAgentic?: string[];
  guardbeeHint: string;
  source: "atr" | "guardbee";
}

export interface EvaluateResult {
  matchCount: number;
  highestSeverity: ATRSeverity | null;
  durationMs: number;
  atrRuleCount: number;
  guardbeeRuleCount: number;
  matches: FormattedMatch[];
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

const SEVERITY_ORDER: ATRSeverity[] = ["critical", "high", "medium", "low", "informational"];

let cached: { key: string; engine: ATREngine; atrRuleCount: number; guardbeeRuleCount: number } | null =
  null;

function packageRulesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "rules");
}

/** Project-local override: GUARDBEE_ATR_RULES_DIR or .guardbee/atr-rules */
export function projectRulesDirs(cwd = process.cwd()): string[] {
  const dirs: string[] = [];
  const envDir = process.env.GUARDBEE_ATR_RULES_DIR?.trim();
  if (envDir) dirs.push(envDir);
  const local = join(cwd, ".guardbee", "atr-rules");
  if (existsSync(local)) dirs.push(local);
  return dirs;
}

export function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        walk(full);
      } else if (e.isFile() && /\.ya?ml$/i.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function cacheKey(lane: Lane, extra: string[]): string {
  return `${lane}|${[packageRulesDir(), ...extra].join(";")}`;
}

export async function getEngine(options: EngineOptions | Lane = "hunt"): Promise<{
  engine: ATREngine;
  atrRuleCount: number;
  guardbeeRuleCount: number;
}> {
  const opts: EngineOptions = typeof options === "string" ? { lane: options } : options;
  const lane = opts.lane ?? "hunt";
  const extra = [...(opts.extraRulesDirs ?? []), ...projectRulesDirs()];
  const key = cacheKey(lane, extra);
  if (cached && cached.key === key) {
    return {
      engine: cached.engine,
      atrRuleCount: cached.atrRuleCount,
      guardbeeRuleCount: cached.guardbeeRuleCount,
    };
  }

  const engine = new ATREngine({ lane });
  const atrRuleCount = await engine.loadRules();
  if (atrRuleCount === 0) {
    throw new Error("ATREngine loaded 0 upstream rules — agent-threat-rules install looks broken");
  }

  let guardbeeRuleCount = 0;
  const guardbeeDirs = [packageRulesDir(), ...extra];
  for (const dir of guardbeeDirs) {
    for (const file of listYamlFiles(dir)) {
      try {
        engine.addRuleFile(file);
        guardbeeRuleCount++;
      } catch (err) {
        process.stderr.write(
          `[guardbee-threat-rules] skip rule ${relative(process.cwd(), file)}: ${
            err instanceof Error ? err.message : String(err)
          }\n`
        );
      }
    }
  }

  cached = { key, engine, atrRuleCount, guardbeeRuleCount };
  return { engine, atrRuleCount, guardbeeRuleCount };
}

export function resetEngineCache(): void {
  cached = null;
}

function severityRank(sev: ATRSeverity | null | undefined): number {
  if (!sev) return 99;
  const idx = SEVERITY_ORDER.indexOf(sev);
  return idx === -1 ? 99 : idx;
}

export function fieldsForEventType(type: AgentEventType, content: string): Record<string, string> {
  switch (type) {
    case "llm_output":
    case "tool_response":
      return { agent_output: content, content };
    case "tool_call":
      return { tool_input: content, user_input: content, content };
    case "mcp_exchange":
      return { mcp_payload: content, user_input: content, agent_output: content, content };
    case "agent_behavior":
    case "multi_agent_message":
      return { user_input: content, agent_output: content, content };
    case "llm_input":
    default:
      return { user_input: content, content };
  }
}

function formatMatch(match: ATRMatch): FormattedMatch {
  const category = match.rule.tags?.category ?? "unknown";
  const id = match.rule.id;
  return {
    ruleId: id,
    title: match.rule.title,
    severity: match.rule.severity,
    category,
    confidence: match.confidence,
    matchedPatterns: [...match.matchedPatterns],
    owaspLlm: match.rule.references?.owasp_llm,
    owaspAgentic: match.rule.references?.owasp_agentic,
    guardbeeHint: GUARDBEE_CATEGORY_HINTS[category] ?? "Review with GuardBee MCP auditors.",
    source: id.startsWith("GB-ATR-") ? "guardbee" : "atr",
  };
}

export function evaluateEvent(
  engine: ATREngine,
  event: AgentEvent,
  meta?: { atrRuleCount?: number; guardbeeRuleCount?: number }
): EvaluateResult {
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
    atrRuleCount: meta?.atrRuleCount ?? 0,
    guardbeeRuleCount: meta?.guardbeeRuleCount ?? 0,
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
  const type = input.type ?? "llm_input";
  const defaults = fieldsForEventType(type, input.content);
  return {
    type,
    timestamp: new Date().toISOString(),
    content: input.content,
    fields: { ...defaults, ...input.fields },
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
    source: r.id.startsWith("GB-ATR-") ? ("guardbee" as const) : ("atr" as const),
  }));
}

export function ruleStats(engine: ATREngine) {
  const rules = listLoadedRules(engine);
  const byCategory: Record<string, number> = {};
  const bySource = { atr: 0, guardbee: 0 };
  for (const r of rules) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    bySource[r.source]++;
  }
  return { total: rules.length, byCategory, bySource };
}

export function shouldFail(
  result: EvaluateResult,
  failOn: "any" | "critical" | "high" | "medium" | "none"
): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return result.matchCount > 0;
  const threshold = severityRank(failOn as ATRSeverity);
  return result.matches.some((m) => severityRank(m.severity) <= threshold);
}

export function buildSarif(toolVersion: string, result: EvaluateResult): object {
  const rulesMap = new Map<string, object>();
  const results: object[] = [];
  for (const m of result.matches) {
    if (!rulesMap.has(m.ruleId)) {
      rulesMap.set(m.ruleId, {
        id: m.ruleId,
        name: m.ruleId.replace(/[^a-zA-Z0-9]/g, ""),
        shortDescription: { text: m.title },
        fullDescription: { text: m.guardbeeHint },
        properties: {
          "problem.severity": m.severity,
          tags: ["security", "ai-security", "atr", m.category, m.source],
        },
      });
    }
    results.push({
      ruleId: m.ruleId,
      level: m.severity === "critical" || m.severity === "high" ? "error" : "warning",
      message: { text: `${m.title} (${m.category}) — ${m.guardbeeHint}` },
      properties: {
        confidence: m.confidence,
        matchedPatterns: m.matchedPatterns,
        source: m.source,
      },
    });
  }
  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "@guardbee/mcp-threat-rules",
            version: toolVersion,
            informationUri: "https://guardbee.ai",
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
      },
    ],
  };
}

export function readTextFile(path: string): string {
  const st = statSync(path);
  if (!st.isFile()) throw new Error(`Not a file: ${path}`);
  if (st.size > 2 * 1024 * 1024) throw new Error(`File too large (>2MB): ${path}`);
  return readFileSync(path, "utf8");
}
