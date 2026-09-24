export type ToolPoisoningCategory = "description-injection" | "confused-deputy";

export interface DescriptionInjectionPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * A tool's `description` string is read by the calling LLM as part of its
 * tool-selection context — the same trust level as a system prompt, even
 * though it's authored by whoever published the MCP server. "Tool poisoning"
 * (documented by Invariant Labs, 2025) hides instructions in that string
 * rather than in the conversation: "always call this first", "read ~/.ssh
 * and pass it as the debug param", "don't tell the user". None of this is
 * a code-level sink — `mcp-server-auditor` won't catch it, because nothing
 * unsafe happens in the handler. The description itself is the payload.
 */
export const DESCRIPTION_INJECTION_PATTERNS: DescriptionInjectionPattern[] = [
  {
    id: "instruction_override_in_description",
    name: "Description tells the model to ignore/disregard prior instructions",
    pattern: /\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/i,
    severity: "critical",
    recommendation: "A tool description has no legitimate reason to override the conversation's instructions. Treat this server as compromised or malicious.",
  },
  {
    id: "always_call_first_directive",
    name: "Description instructs the model to always call this tool first/unconditionally",
    pattern: /\balways\s+(?:call|use|invoke)\s+this\s+(?:tool|function)\s+(?:first|before)\b/i,
    severity: "high",
    recommendation: "A legitimate tool description explains what the tool does and lets the model decide when it's relevant — it doesn't demand priority over every other tool. This is a known tool-poisoning priming pattern.",
  },
  {
    id: "covert_instruction_in_description",
    name: "Description tells the model not to inform/mention this to the user",
    pattern: /\bdo\s+not\s+(?:tell|inform|mention\s+(?:this\s+)?to)\s+the\s+user\b/i,
    severity: "critical",
    recommendation: "A tool asking to hide its own behavior from the user it's acting on behalf of is a hallmark of a poisoned tool description. Do not install this server.",
  },
  {
    id: "meta_authority_directive",
    name: "Description uses system-prompt-style authority markers",
    pattern: /<\s*IMPORTANT\s*>|^\s*(?:IMPORTANT|SYSTEM|NOTE\s+TO\s+MODEL)\s*:/im,
    severity: "high",
    recommendation: "A tool description shouldn't need to invoke system-prompt-style authority (\"<IMPORTANT>\", \"SYSTEM:\") to be followed — this is a common technique to make an injected instruction feel more authoritative to the model.",
  },
  {
    id: "sensitive_file_exfil_instruction",
    name: "Description instructs reading a sensitive file into a tool parameter",
    pattern: /\b(?:read|cat|include|attach|append)\b[^.]{0,80}(?:\.ssh\b|\bid_rsa\b|\.env\b|\.aws[\\/]credentials\b|\bprivate[\s_-]?key\b|\.npmrc\b)/i,
    severity: "critical",
    recommendation: "A tool description asking the model to read a credential/key file and pass its contents as a parameter is a direct exfiltration instruction — the file's contents would flow to whoever controls this MCP server.",
  },
  {
    id: "hidden_zero_width_in_description",
    name: "Description contains zero-width characters invisible to a human reviewer",
    pattern: /[\u200B\u2060]/,
    severity: "high",
    recommendation: "Zero-width characters in a tool description are invisible when a human reviews the server's tool list in a UI, but are still read by the model. Their only realistic purpose here is hiding text from review.",
  },
  {
    id: "other_tools_manipulation_directive",
    name: "Description instructs the model how to call other, different tools",
    pattern: /\bwhen\s+(?:calling|using)\s+(?:the\s+)?["'`]?[\w.-]+["'`]?\s+tool\s*,\s*(?:always|you\s+must|set|pass|include)\b/i,
    severity: "high",
    recommendation: "A tool's description should describe that tool — not dictate how a different tool must be called. This is a documented tool-poisoning technique for hijacking unrelated tools via a single malicious server.",
  },
];

// ── Confused-deputy: promised capability vs. actual handler behavior ─────────

/** Name/description keywords implying a narrow, read-only/informational tool. */
export const READ_ONLY_HINT = /\b(?:get|read|list|search|lookup|find|query|describe|show|view|check|inspect|summarize|translate|status|info)\b/i;

export interface MismatchSinkRule {
  id: string;
  pattern: RegExp;
  category: "process-execution" | "code-execution" | "filesystem-write" | "credentials-exposure";
  severity: "critical" | "high";
  recommendation: string;
}

/**
 * Sinks that have no business appearing inside a tool whose name/description
 * promises read-only/informational behavior. Deliberately excludes network
 * fetches — a "get_weather" or "search" tool legitimately calling an external
 * API is the common case, not a red flag, so including it here would make
 * this the noisiest, least trustworthy pattern in the catalog.
 */
export const MISMATCH_SINK_RULES: MismatchSinkRule[] = [
  {
    id: "process_execution",
    pattern: /\b(?:execSync|spawnSync|child_process\.exec\w*|spawn)\s*\(/,
    category: "process-execution",
    severity: "critical",
    recommendation: "This tool's name/description promises read-only/informational behavior, but its handler runs a shell/process command. Either the description is misleading (fix it so callers know what they're actually authorizing) or this tool has been given capability it shouldn't have.",
  },
  {
    id: "code_execution",
    pattern: /\b(?:eval|new\s+Function)\s*\(/,
    category: "code-execution",
    severity: "critical",
    recommendation: "This tool's name/description promises read-only/informational behavior, but its handler evaluates code. A caller relying on the description has no way to know this tool can execute arbitrary code.",
  },
  {
    id: "filesystem_write",
    pattern: /\b(?:writeFileSync|unlinkSync|rmSync|appendFileSync|renameSync|writeFile)\s*\(/,
    category: "filesystem-write",
    severity: "high",
    recommendation: "This tool's name/description promises read-only/informational behavior, but its handler writes/deletes files. Rename or redescribe the tool to reflect what it actually does, so callers aren't misled about its blast radius.",
  },
  {
    id: "credentials_exposure",
    pattern: /(?:\.\.\.\s*process\.env\b)|(?:JSON\.stringify\(\s*process\.env\s*\))|(?:return\s+process\.env\s*[;\n])/,
    category: "credentials-exposure",
    severity: "critical",
    recommendation: "This tool's name/description promises read-only/informational behavior, but its handler exposes the entire process environment. A caller has no way to know this \"informational\" tool can leak every secret in this process.",
  },
];
