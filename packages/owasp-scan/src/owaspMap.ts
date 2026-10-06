import type { OwaspId } from "./types.js";

export const OWASP_TITLES: Record<OwaspId, string> = {
  "MCP01:2025": "Token / credential exposure",
  "MCP02:2025": "Privilege / excessive agency",
  "MCP03:2025": "Tool poisoning / rug pull surface",
  "MCP04:2025": "Supply chain / dependency risk",
  "MCP05:2025": "Command / code injection via tools",
  "MCP06:2025": "Prompt / context injection",
  "MCP07:2025": "Auth / OAuth misconfiguration",
  "MCP08:2025": "Lack of audit and telemetry",
  "MCP09:2025": "Shadow MCP servers",
  "MCP10:2025": "Toxic flows / context oversharing",
};

/** Map a scanner finding to an OWASP MCP Top 10 id. */
export function resolveOwasp(
  explicit: string | undefined,
  patternId: string,
  source: string
): OwaspId | null {
  if (explicit && /^MCP\d{2}:2025$/.test(explicit)) return explicit as OwaspId;

  if (source === "secret-scanner") return "MCP01:2025";
  if (source === "tool-poisoning") return "MCP03:2025";
  if (source === "oauth-auditor") return "MCP07:2025";
  if (source === "audit-gap") return "MCP08:2025";
  if (source === "config-discover") return "MCP09:2025";
  if (source === "context-oversharing" || source === "toxic-flow") return "MCP10:2025";

  if (source === "mcp-server-auditor") {
    if (/shell|eval|sql_injection/i.test(patternId)) return "MCP05:2025";
    if (/unrestricted_shell|excessive/i.test(patternId)) return "MCP02:2025";
    if (/secret|env_exposed|hardcoded/i.test(patternId)) return "MCP01:2025";
    if (/ssrf|cors/i.test(patternId)) return "MCP02:2025";
    return "MCP02:2025";
  }

  return null;
}
