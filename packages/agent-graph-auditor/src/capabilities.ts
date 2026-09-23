export type CapabilityCategory = "code-execution" | "process-execution" | "filesystem-write" | "network" | "credentials-access";

export interface CapabilityRule {
  id: string;
  /** Matched against a tool's variable name, string name=/tool literal, or class name. */
  pattern: RegExp;
  category: CapabilityCategory;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * Name-based heuristics for what a tool/function grants an agent that calls it.
 * These are the same handful of capability classes that turn "an agent said
 * something" into "something happened" — the same shape of risk ai-code-scanner
 * and mcp-server-auditor flag when a *single* agent/server holds one directly.
 * This package's job is different: finding where an agent reaches one of these
 * *indirectly*, through another agent it's allowed to delegate to.
 */
export const CAPABILITY_RULES: CapabilityRule[] = [
  {
    id: "python_repl",
    pattern: /python_?repl|pythonreplt(?:ool)?/i,
    category: "code-execution",
    severity: "critical",
    recommendation: "A Python REPL tool executes arbitrary code. Any agent that can reach it — directly or by delegation — can be induced to run anything.",
  },
  {
    id: "code_execution",
    pattern: /code_?exec(?:ution)?|exec_?code|run_?code|code_?interpreter/i,
    category: "code-execution",
    severity: "critical",
    recommendation: "A code-execution tool/config grants arbitrary code execution. Restrict which agents can reach it and sandbox it (e.g. Docker) even then.",
  },
  {
    id: "shell_tool",
    pattern: /shell_?tool|terminal_?tool|\bbash_?tool\b/i,
    category: "process-execution",
    severity: "critical",
    recommendation: "A shell/terminal tool grants arbitrary command execution. Any agent that can reach it can be induced to run anything the host process can.",
  },
  {
    id: "subprocess_command",
    pattern: /subprocess|command_?exec(?:utor)?|run_?command/i,
    category: "process-execution",
    severity: "critical",
    recommendation: "A command-execution tool has the same blast radius as a shell. Restrict which agents can reach it.",
  },
  {
    id: "file_write",
    pattern: /write_?file|file_?write|delete_?file|file_?delete|file_?manage(?:ment)?|filesystem_?tool/i,
    category: "filesystem-write",
    severity: "high",
    recommendation: "A file-write/delete tool can modify or destroy data on the host. Scope its allowed paths and restrict which agents can reach it.",
  },
  {
    id: "web_request",
    pattern: /requests_?tool|http_?tool|url_?fetch|web_?browser|api_?call_?tool/i,
    category: "network",
    severity: "medium",
    recommendation: "A network-request tool can be used for SSRF or data exfiltration. Restrict which agents can reach it and consider an egress allowlist.",
  },
  {
    id: "cloud_admin",
    pattern: /aws_?tool|cloud_?admin|secrets_?manager|admin_?tool|cloud_?tool/i,
    category: "credentials-access",
    severity: "critical",
    recommendation: "A cloud/admin/secrets tool can reach credentials or infrastructure control. Restrict which agents can reach it tightly.",
  },
];

export function classifyToolName(name: string): CapabilityRule | null {
  for (const rule of CAPABILITY_RULES) {
    if (rule.pattern.test(name)) return rule;
  }
  return null;
}
