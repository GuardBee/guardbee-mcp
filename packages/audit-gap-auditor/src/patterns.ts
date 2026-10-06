export type AuditGapCategory =
  | "missing-telemetry"
  | "unsafe-logging"
  | "disabled-audit"
  | "silent-failure";

export interface AuditGapCheck {
  id: string;
  name: string;
  category: AuditGapCategory;
  severity: "critical" | "high" | "medium";
  owasp: "MCP08:2025";
  recommendation: string;
}

/**
 * Checks derived from OWASP MCP08:2025 — Lack of Audit and Telemetry.
 * security-proxy already writes a hash-chained audit log at the gateway;
 * this package asks whether the MCP *server itself* leaves a usable trail.
 */
export const AUDIT_GAP_CHECKS: AuditGapCheck[] = [
  {
    id: "mcp_server_without_tool_audit",
    name: "MCP server registers tools but never logs tool invocations",
    category: "missing-telemetry",
    severity: "high",
    owasp: "MCP08:2025",
    recommendation:
      "OWASP MCP08 requires a record of tool invocations for incident response. Log at least tool name, session/request id, and outcome (success/deny/error) for every CallTool — never the raw secret-bearing args. GuardBee's security-proxy can supply a hash-chained trail if the server cannot.",
  },
  {
    id: "raw_tool_args_logged",
    name: "Tool arguments are logged verbatim",
    category: "unsafe-logging",
    severity: "critical",
    owasp: "MCP08:2025",
    recommendation:
      "Logging the full tool args object puts credentials and PII into the audit stream (MCP01 + MCP08). Log field names and redacted shapes only — e.g. which keys were present, not their values.",
  },
  {
    id: "raw_tool_result_logged",
    name: "Tool results are logged verbatim",
    category: "unsafe-logging",
    severity: "high",
    owasp: "MCP08:2025",
    recommendation:
      "Tool results often contain secrets or customer data. Record success/failure and a size or hash, not the full payload, in durable logs.",
  },
  {
    id: "audit_disabled_in_code",
    name: "Audit or telemetry is hard-disabled in source",
    category: "disabled-audit",
    severity: "high",
    owasp: "MCP08:2025",
    recommendation:
      "A hard-coded `audit: false`, `enableAudit: false`, or `TELEMETRY=0` / `AUDIT=0` assignment removes the trail MCP08 expects. Keep audit on by default; disable only via an explicit, reviewed ops switch outside source.",
  },
  {
    id: "tool_error_swallowed_silently",
    name: "Tool handler swallows errors without logging",
    category: "silent-failure",
    severity: "medium",
    owasp: "MCP08:2025",
    recommendation:
      "An empty or return-only catch around a tool handler hides failed privileged actions. Log the error class and tool name (not secrets) before returning a safe client message.",
  },
  {
    id: "audit_log_without_correlation_id",
    name: "Audit log call has no session or request correlation id",
    category: "missing-telemetry",
    severity: "medium",
    owasp: "MCP08:2025",
    recommendation:
      "MCP08 investigations need to tie a tool call to a user/session. Include a requestId, sessionId, or auth subject alongside the tool name in every audit event.",
  },
];

export function checkById(id: string): AuditGapCheck {
  const found = AUDIT_GAP_CHECKS.find((check) => check.id === id);
  if (!found) throw new Error(`Unknown audit-gap check: ${id}`);
  return found;
}
