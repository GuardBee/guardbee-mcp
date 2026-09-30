import { classifyTool, type Capability, type FlowCategory, type ToolRecord } from "./capabilities.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: FlowCategory;
  severity: "critical" | "high" | "medium";
  owasp: string;
  recommendation: string;
  tools: string[];
  capabilities: Capability[];
  match: string;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface AuditResult {
  toolCount: number;
  grade: Grade;
  score: number;
  byCapability: Record<Capability, string[]>;
  findings: Finding[];
  durationMs: number;
}

function toolsWith(cap: Capability, classified: Map<string, Capability[]>): string[] {
  return [...classified.entries()].filter(([, caps]) => caps.includes(cap)).map(([name]) => name);
}

export function gradeFromFindings(findings: Finding[]): { grade: Grade; score: number } {
  if (findings.some((f) => f.patternId === "lethal_trifecta")) return { grade: "F", score: 0 };
  if (findings.some((f) => f.severity === "critical")) return { grade: "D", score: 25 };
  if (findings.some((f) => f.severity === "high")) return { grade: "C", score: 50 };
  if (findings.some((f) => f.severity === "medium")) return { grade: "B", score: 75 };
  return { grade: "A", score: 100 };
}

/**
 * Audits a tools/list-shaped catalog for Simon Willison's lethal trifecta:
 * untrusted content + sensitive data + (exfiltration OR destruction) on one server.
 */
export function auditCatalog(tools: ToolRecord[], label = "catalog"): AuditResult {
  const start = Date.now();
  const classified = new Map<string, Capability[]>();
  for (const tool of tools) {
    classified.set(tool.name, classifyTool(tool));
  }

  const byCapability: Record<Capability, string[]> = {
    "untrusted-content": toolsWith("untrusted-content", classified),
    "sensitive-data": toolsWith("sensitive-data", classified),
    exfiltration: toolsWith("exfiltration", classified),
    destructive: toolsWith("destructive", classified),
  };

  const findings: Finding[] = [];
  const hasUntrusted = byCapability["untrusted-content"].length > 0;
  const hasSensitive = byCapability["sensitive-data"].length > 0;
  const hasExfil = byCapability.exfiltration.length > 0;
  const hasDestruct = byCapability.destructive.length > 0;
  const hasOutbound = hasExfil || hasDestruct;

  if (hasUntrusted && hasSensitive && hasOutbound) {
    const involved = [
      ...byCapability["untrusted-content"],
      ...byCapability["sensitive-data"],
      ...byCapability.exfiltration,
      ...byCapability.destructive,
    ];
    findings.push({
      patternId: "lethal_trifecta",
      patternName: "Lethal trifecta (toxic flow) across this MCP server's tools",
      category: "toxic-flow",
      severity: "critical",
      owasp: "MCP10:2025",
      recommendation:
        "This server can read untrusted content, reach private/sensitive data, and send data out or destroy it. A single prompt injection can chain those capabilities. Split the server: keep research/fetch tools off any vault, DB, or mail connector, or put a human approval gate on exfil/destructive tools.",
      tools: [...new Set(involved)],
      capabilities: [
        "untrusted-content",
        "sensitive-data",
        ...(hasExfil ? (["exfiltration"] as Capability[]) : []),
        ...(hasDestruct ? (["destructive"] as Capability[]) : []),
      ],
      match: `${label}: untrusted=[${byCapability["untrusted-content"].join(", ")}] sensitive=[${byCapability["sensitive-data"].join(", ")}] outbound=[${[...byCapability.exfiltration, ...byCapability.destructive].join(", ")}]`,
    });
  } else if (hasSensitive && hasExfil) {
    findings.push({
      patternId: "sensitive_plus_exfil",
      patternName: "Sensitive data tools share a server with an exfiltration path",
      category: "dangerous-pair",
      severity: "high",
      owasp: "MCP10:2025",
      recommendation:
        "Even without an obvious untrusted-content tool, a compromised prompt or sibling MCP can still push private data out through send/export/webhook tools. Isolate vault/DB readers from outbound connectors.",
      tools: [...new Set([...byCapability["sensitive-data"], ...byCapability.exfiltration])],
      capabilities: ["sensitive-data", "exfiltration"],
      match: `${label}: sensitive=[${byCapability["sensitive-data"].join(", ")}] exfil=[${byCapability.exfiltration.join(", ")}]`,
    });
  } else if (hasUntrusted && hasExfil) {
    findings.push({
      patternId: "untrusted_plus_exfil",
      patternName: "Untrusted-content tools share a server with an exfiltration path",
      category: "dangerous-pair",
      severity: "high",
      owasp: "MCP06:2025",
      recommendation:
        "Fetched pages or issues can inject instructions that then use send/webhook tools. Prefer a research-only server with no outbound side effects.",
      tools: [...new Set([...byCapability["untrusted-content"], ...byCapability.exfiltration])],
      capabilities: ["untrusted-content", "exfiltration"],
      match: `${label}: untrusted=[${byCapability["untrusted-content"].join(", ")}] exfil=[${byCapability.exfiltration.join(", ")}]`,
    });
  } else if (hasSensitive && hasDestruct) {
    findings.push({
      patternId: "sensitive_plus_destruct",
      patternName: "Sensitive data tools share a server with destructive tools",
      category: "dangerous-pair",
      severity: "high",
      owasp: "MCP02:2025",
      recommendation:
        "An injection that reaches delete/drop/purge next to vault or DB access is a wipe risk. Require confirmation or move destructive tools to a separate, tightly approved server.",
      tools: [...new Set([...byCapability["sensitive-data"], ...byCapability.destructive])],
      capabilities: ["sensitive-data", "destructive"],
      match: `${label}: sensitive=[${byCapability["sensitive-data"].join(", ")}] destruct=[${byCapability.destructive.join(", ")}]`,
    });
  }

  // Single-tool combinations: one registration that itself spans the trifecta.
  for (const [name, caps] of classified) {
    const u = caps.includes("untrusted-content");
    const s = caps.includes("sensitive-data");
    const o = caps.includes("exfiltration") || caps.includes("destructive");
    if (u && s && o) {
      findings.push({
        patternId: "single_tool_trifecta",
        patternName: `Tool "${name}" alone spans the lethal trifecta`,
        category: "toxic-flow",
        severity: "critical",
        owasp: "MCP10:2025",
        recommendation:
          "Split this tool. A single handler that fetches untrusted content, touches secrets, and can send or destroy data is the densest toxic-flow shape.",
        tools: [name],
        capabilities: caps,
        match: name,
      });
    }
  }

  const { grade, score } = gradeFromFindings(findings);
  return {
    toolCount: tools.length,
    grade,
    score,
    byCapability,
    findings,
    durationMs: Date.now() - start,
  };
}

export function parseToolsJson(raw: string): ToolRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed as ToolRecord[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { tools?: unknown }).tools)) {
    return (parsed as { tools: ToolRecord[] }).tools;
  }
  throw new Error("Expected a tools array or { tools: [...] } JSON document");
}
