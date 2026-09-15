export type AuditCategory =
  | "excessive-agency" // a tool grants the caller shell/code execution
  | "unsafe-input" // a tool parameter flows into a dangerous sink unsanitized
  | "loose-schema" // a tool's input schema accepts more than it should
  | "secrets-exposure" // credentials or the whole environment reachable by a caller
  | "network-exposure"; // the server itself is overly reachable (CORS, etc.)

export interface McpAuditPattern {
  id: string;
  name: string;
  category: AuditCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  /** Neden riskli olduğu ve ne yapılması gerektiği — bulgu ile birlikte gösterilir. */
  recommendation: string;
}

/**
 * `ai-code-scanner`'ın aksine bu paket "LLM entegrasyon kodu"na değil,
 * **MCP server'ın kendisine** bakıyor: bir tool tanımı (`server.tool(...)`)
 * ne kadar yetkili, parametreleri ne kadar gevşek, handler'ı hangi
 * sink'lere (shell/fs/http/sql) doğrudan tool girdisi geçiriyor. Regex'ler
 * heuristic'tir — tam bir AST/tip analizi yapmaz, düşük yanlış-pozitifli
 * kalıplara odaklanır (secret-scanner ve ai-code-scanner'la aynı felsefe).
 */
export const MCP_AUDITOR_PATTERNS: McpAuditPattern[] = [
  // ── Excessive agency ───────────────────────────────────────────────────────
  {
    id: "shell_exec_from_tool_input",
    name: "Tool handler passes raw tool input to a shell/process exec call",
    category: "excessive-agency",
    pattern: /\b(?:execSync|spawnSync|exec|spawn)\s*\(\s*(?:input|params|args)\s*\.\s*\w+/g,
    severity: "critical",
    recommendation:
      "A tool parameter is passed straight into a shell/process exec call. Any caller of this tool — including a prompt-injected LLM upstream — can run arbitrary commands. Validate against a strict allowlist of commands/args instead of executing the parameter directly.",
  },
  {
    id: "eval_of_tool_input",
    name: "Tool handler evaluates raw tool input as code",
    category: "excessive-agency",
    pattern: /\b(?:eval|new\s+Function)\s*\(\s*(?:input|params|args)\s*\.\s*\w+/g,
    severity: "critical",
    recommendation:
      "Executing a tool parameter as code turns any caller of this tool into a remote code execution vector. Never eval() input; parse and validate it as data instead.",
  },
  {
    id: "unrestricted_shell_tool_name",
    name: "Tool name grants shell/arbitrary code or SQL execution",
    category: "excessive-agency",
    pattern:
      /\.tool\(\s*["'](?:run_shell|execute_command|run_command|execute_shell|eval_code|execute_code|run_script|shell_exec|run_sql|execute_sql|run_query)["']/gi,
    severity: "high",
    recommendation:
      "A tool named like this typically hands the calling LLM arbitrary shell/code/SQL execution. If intentional, gate it behind an explicit opt-in config flag (off by default) and a strict allowlist — not just a cautious-sounding tool description.",
  },

  // ── Unsafe input handling ───────────────────────────────────────────────────
  {
    id: "fs_write_from_raw_tool_input",
    name: "Filesystem write/delete uses a raw tool input path",
    category: "unsafe-input",
    pattern: /\b(?:writeFileSync|unlinkSync|rmSync|appendFileSync|renameSync)\s*\(\s*(?:input|params|args)\s*\.\s*\w+/g,
    severity: "high",
    recommendation:
      "A path taken directly from tool input is used in a filesystem write/delete call with no visible sanitization — a caller can supply '../'-style paths (path traversal). Resolve the path and verify it stays inside an allowed base directory before touching the filesystem.",
  },
  {
    id: "ssrf_fetch_from_tool_input",
    name: "Outbound HTTP request target comes directly from tool input",
    category: "unsafe-input",
    pattern: /\b(?:fetch|axios\.get|axios\.post|axios\.request|http\.get|https\.get)\s*\(\s*(?:input|params|args)\s*\.\s*\w+/g,
    severity: "high",
    recommendation:
      "A request URL/host taken directly from tool input, with no visible allowlist, lets a caller make this server request internal or private URLs (SSRF) — e.g. a cloud metadata endpoint. Validate the host against an allowlist before making the request.",
  },
  {
    id: "sql_injection_via_tool_input",
    name: "SQL statement built by interpolating raw tool input",
    category: "unsafe-input",
    pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,200}?\$\{\s*(?:input|params|args)\s*\.\s*\w+/gi,
    severity: "critical",
    recommendation:
      "A SQL statement is built with a template-literal interpolation of a raw tool parameter — classic SQL injection, now reachable by anything that can call this tool. Use parameterized queries; never interpolate tool input into SQL text.",
  },

  // ── Loose schema ────────────────────────────────────────────────────────────
  {
    id: "overly_permissive_tool_schema",
    name: "Tool parameter typed z.any()/z.unknown()",
    category: "loose-schema",
    pattern: /\.tool\(\s*["'][\w-]+["'][\s\S]{0,300}?:\s*z\.(?:any|unknown)\(\)/g,
    severity: "medium",
    recommendation:
      "A parameter typed z.any()/z.unknown() accepts anything, including shapes the handler doesn't expect — this often becomes an injection point downstream (a NoSQL/SQL filter, a shell arg). Give every parameter the narrowest schema that covers legitimate input.",
  },

  // ── Secrets exposure ────────────────────────────────────────────────────────
  {
    id: "hardcoded_secret_in_tool_schema",
    name: "Credential-shaped tool parameter has a hardcoded default",
    category: "secrets-exposure",
    pattern: /\b(?:apiKey|token|secret|password|accessKey)\s*:\s*z\.string\(\)[^,\n]*\.default\(\s*["'][^"']{8,}["']\s*\)/gi,
    severity: "critical",
    recommendation:
      "A tool schema's default value for a credential-shaped field is a hardcoded literal. Defaults ship in the published server/manifest and are visible to anyone who inspects it. Never default a secret field — require it to be supplied via environment/config.",
  },
  {
    id: "full_env_exposed_to_tool_caller",
    name: "The whole process.env is spread, stringified, or returned",
    category: "secrets-exposure",
    pattern: /(?:\.\.\.\s*process\.env\b)|(?:JSON\.stringify\(\s*process\.env\s*\))|(?:return\s+process\.env\s*[;\n])/g,
    severity: "critical",
    recommendation:
      "The entire process.env object is being spread, serialized, or returned instead of reading one named variable. If this happens inside a tool handler, the calling LLM — and thus any prompt-injected instruction upstream — can potentially read every secret in this process's environment. Only read specific, named variables.",
  },

  // ── Network exposure ─────────────────────────────────────────────────────────
  {
    id: "permissive_cors_on_server",
    name: "Wildcard or default-open CORS on the server's HTTP transport",
    category: "network-exposure",
    pattern: /\bAccess-Control-Allow-Origin["']?\s*[:,=]\s*["']\*["']|\bcors\(\s*\)/g,
    severity: "medium",
    recommendation:
      "A wildcard CORS origin (or the cors() middleware called with no options, which defaults to allow-all) lets any website make requests to this MCP server's HTTP transport from a victim's browser. Restrict Access-Control-Allow-Origin to a known allowlist.",
  },
];
