/**
 * Every GuardBee MCP package the suite can serve and run: its id (the CLI
 * command and the `--tools` name), the prefix its tools get in the combined
 * server, and the groups it belongs to.
 */
export interface SuitePackage {
  id: string;
  pkg: string;
  /** Prefix for tool names in the combined server, so `scan_text` from two packages do not collide. */
  prefix: string;
  summary: string;
  groups: Group[];
}

export const GROUPS = {
  recommended: "A one-pass OWASP MCP Top 10 scan, secrets, prompt injection, toxic flows, client configs and dependencies",
  code: "Static checks of source code, configs and content on disk",
  "supply-chain": "Dependencies, hallucinated packages, model files, MCP client configs and tool-definition drift",
  network: "Checks that reach out to a host: TLS, DNS, vector stores, a live LLM",
  platform: "Tools that call the GuardBee platform (need GUARDBEE_API_KEY)",
} as const;
export type Group = keyof typeof GROUPS;

export const PACKAGES: SuitePackage[] = [
  { id: "owasp-scan", pkg: "@guardbee/mcp-owasp-scan", prefix: "owasp", summary: "OWASP MCP Top 10 in one pass over a codebase or a live server, A–F grade", groups: ["recommended", "code"] },
  { id: "secret-scanner", pkg: "@guardbee/mcp-secret-scanner", prefix: "secrets", summary: "API keys, tokens and passwords in files, git history and agent transcripts", groups: ["recommended", "code"] },
  { id: "prompt-injection-scanner", pkg: "@guardbee/mcp-prompt-injection-scanner", prefix: "injection", summary: "Prompt injection in documents, web pages and RAG content", groups: ["recommended", "code"] },
  { id: "toxic-flow-auditor", pkg: "@guardbee/mcp-toxic-flow-auditor", prefix: "toxic_flow", summary: "Lethal trifecta: untrusted input, sensitive data and egress in one agent", groups: ["recommended", "code"] },
  { id: "mcp-config-auditor", pkg: "@guardbee/mcp-config-auditor", prefix: "mcp_config", summary: "MCP client configs (Cursor, Claude, Windsurf, VS Code) and shadow servers", groups: ["recommended", "supply-chain"] },
  { id: "dependency-auditor", pkg: "@guardbee/mcp-dependency-auditor", prefix: "deps", summary: "Known CVEs in npm and PyPI dependencies (OSV)", groups: ["recommended", "supply-chain"] },
  { id: "prompt-leak-scanner", pkg: "@guardbee/mcp-prompt-leak-scanner", prefix: "leak", summary: "Credentials and PII in outbound LLM prompts, before they leave your app", groups: ["code"] },
  { id: "tool-poisoning-scanner", pkg: "@guardbee/mcp-tool-poisoning-scanner", prefix: "poisoning", summary: "Hidden instructions in MCP tool descriptions and schemas", groups: ["code"] },
  { id: "mcp-server-auditor", pkg: "@guardbee/mcp-server-auditor", prefix: "server_audit", summary: "Shell, eval, SSRF and secrets in an MCP server's source", groups: ["code"] },
  { id: "oauth-auditor", pkg: "@guardbee/mcp-oauth-auditor", prefix: "oauth", summary: "OAuth 2.1 mistakes in an MCP server's auth code: token passthrough, audience, PKCE", groups: ["code"] },
  { id: "audit-gap-auditor", pkg: "@guardbee/mcp-audit-gap-auditor", prefix: "audit_gap", summary: "Tool calls without an audit trail (OWASP MCP08)", groups: ["code"] },
  { id: "context-oversharing-auditor", pkg: "@guardbee/mcp-context-oversharing-auditor", prefix: "oversharing", summary: "Context oversharing (MCP10): session dumps, cross-user context, unscoped recalls", groups: ["code"] },
  { id: "ai-code-scanner", pkg: "@guardbee/mcp-ai-code-scanner", prefix: "ai_code", summary: "Insecure LLM integrations: exposed keys, unsafe model output, PII to third-party LLMs", groups: ["code"] },
  { id: "agent-graph-auditor", pkg: "@guardbee/mcp-agent-graph-auditor", prefix: "agent_graph", summary: "Transitive excessive agency across LangGraph, CrewAI and AutoGen agents", groups: ["code"] },
  { id: "a2a-auditor", pkg: "@guardbee/mcp-a2a-auditor", prefix: "a2a", summary: "Agent2Agent (A2A) implementation code: webhook SSRF, unauthenticated Agent Cards", groups: ["code"] },
  { id: "elicitation-auditor", pkg: "@guardbee/mcp-elicitation-auditor", prefix: "elicitation", summary: "MCP elicitation that asks users for secrets or sends them to third parties", groups: ["code"] },
  { id: "memory-poisoning-scanner", pkg: "@guardbee/mcp-memory-poisoning-scanner", prefix: "memory", summary: "Untrusted input written into persistent agent memory", groups: ["code"] },
  { id: "unbounded-consumption-auditor", pkg: "@guardbee/mcp-unbounded-consumption-auditor", prefix: "consumption", summary: "Denial of wallet: missing token limits, timeouts and loop bounds", groups: ["code"] },
  { id: "threat-rules", pkg: "@guardbee/mcp-threat-rules", prefix: "threat_rules", summary: "Agent Threat Rules (ATR) on text, files and agent events", groups: ["code"] },
  { id: "document-scanner", pkg: "@guardbee/mcp-document-scanner", prefix: "document", summary: "PII and credentials in PDFs and images (OCR) before they reach an LLM", groups: ["code"] },
  { id: "reverse-shield", pkg: "@guardbee/mcp-reverse-shield", prefix: "reverse", summary: "How easily a shipped app can be reverse engineered (web, Electron, APK/AAB, IPA, Unity, native); fix diffs, CI baselines", groups: ["code"] },
  { id: "slopsquat-scanner", pkg: "@guardbee/mcp-slopsquat-scanner", prefix: "slopsquat", summary: "Hallucinated or brand-new package names (slopsquatting)", groups: ["supply-chain"] },
  { id: "model-scanner", pkg: "@guardbee/mcp-model-scanner", prefix: "model", summary: "Malicious pickle, safetensors, Keras and ONNX model files", groups: ["supply-chain"] },
  { id: "rug-pull-detector", pkg: "@guardbee/mcp-rug-pull-detector", prefix: "rug_pull", summary: "MCP tool definitions that change after you approved them", groups: ["supply-chain"] },
  { id: "ssl-inspector", pkg: "@guardbee/mcp-ssl-inspector", prefix: "ssl", summary: "TLS certificates, ciphers and HSTS", groups: ["network"] },
  { id: "dns-intelligence", pkg: "@guardbee/mcp-dns-intelligence", prefix: "dns", summary: "DNS records, SPF/DMARC/DKIM, subdomain takeover", groups: ["network"] },
  { id: "vector-store-scanner", pkg: "@guardbee/mcp-vector-store-scanner", prefix: "vector_store", summary: "Unauthenticated vector databases (Weaviate, Qdrant, Chroma, pgvector…)", groups: ["network"] },
  { id: "llm-redteam", pkg: "@guardbee/mcp-llm-redteam", prefix: "redteam", summary: "Jailbreak and extraction probes against an LLM endpoint you control", groups: ["network"] },
  { id: "vulnerability-scanner", pkg: "@guardbee/mcp-vulnerability-scanner", prefix: "vuln", summary: "GuardBee platform security scans and their findings", groups: ["platform"] },
  { id: "compliance-checker", pkg: "@guardbee/mcp-compliance-checker", prefix: "compliance", summary: "KVKK, GDPR and CCPA compliance of a website via the GuardBee API", groups: ["platform"] },
];

/** The packages a `--tools` value names: ids and group names, comma-separated; `all` for every package. */
export function selectPackages(spec = "recommended"): SuitePackage[] {
  const wanted = new Set<SuitePackage>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part === "all") PACKAGES.forEach((p) => wanted.add(p));
    else if (part in GROUPS) PACKAGES.filter((p) => p.groups.includes(part as Group)).forEach((p) => wanted.add(p));
    else {
      const found = PACKAGES.find((p) => p.id === part || p.pkg === part);
      if (!found) throw new Error(`Unknown package or group "${part}". Groups: ${Object.keys(GROUPS).join(", ")}, all. Run \`guardbee list\` for package ids.`);
      wanted.add(found);
    }
  }
  return PACKAGES.filter((p) => wanted.has(p));
}

/** A tool's name in the combined server: the package prefix, unless the name already says it ("owasp_scan_path", "inspect_ssl"). */
export function suiteToolName(prefix: string, name: string): string {
  const tokens = name.split("_");
  const prefixTokens = prefix.split("_");
  const has = tokens.some((_, i) => prefixTokens.every((t, j) => tokens[i + j] === t));
  return has ? name : `${prefix}_${name}`;
}
