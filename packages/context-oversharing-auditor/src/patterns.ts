export type ContextOvershareCategory =
  | "session-dump"
  | "cross-user-context"
  | "system-prompt-leak"
  | "unscoped-memory"
  | "tool-history-bleed";

export interface ContextOvershareCheck {
  id: string;
  name: string;
  category: ContextOvershareCategory;
  severity: "critical" | "high" | "medium";
  owasp: "MCP10:2025";
  recommendation: string;
}

/**
 * Checks for OWASP MCP10:2025 context oversharing — distinct from toxic-flow
 * (lethal trifecta across a tool catalog). These patterns ask whether a single
 * session/memory/tool handler returns more context than the current user/tenant
 * should see.
 */
export const CONTEXT_OVERSHARE_CHECKS: ContextOvershareCheck[] = [
  {
    id: "tool_dumps_full_conversation",
    name: "Tool returns or logs the full conversation / message history",
    category: "session-dump",
    severity: "critical",
    owasp: "MCP10:2025",
    recommendation:
      "Returning the entire messages[] / conversationHistory to a tool caller overshares prior turns (and any secrets they contained) with whatever can invoke the tool. Scope the response to the current turn or a redacted summary.",
  },
  {
    id: "unscoped_memory_recall_tool",
    name: "Memory/recall tool has no user or tenant scope in its name or handler",
    category: "unscoped-memory",
    severity: "high",
    owasp: "MCP10:2025",
    recommendation:
      "Tools named get_all_memories / dump_memory / list_context without a userId/tenantId filter can recall another principal's archival memory. Require an authenticated subject and filter the store by that subject before returning rows.",
  },
  {
    id: "shared_global_session_store",
    name: "Global session/context Map used without a per-user key",
    category: "cross-user-context",
    severity: "high",
    owasp: "MCP10:2025",
    recommendation:
      "A module-level Map/dict holding chat context with a single shared key (or no key) mixes tenants. Key every entry by sessionId + userId (or tenantId) and never fall back to a global bucket.",
  },
  {
    id: "system_prompt_exposed_via_tool",
    name: "Tool handler returns system prompt / developer instructions",
    category: "system-prompt-leak",
    severity: "high",
    owasp: "MCP10:2025",
    recommendation:
      "Exposing systemPrompt / SYSTEM_PROMPT / developer instructions through a tool turns MCP10 oversharing into a prompt-leak channel. Keep instructions server-side; never return them in tool results.",
  },
  {
    id: "cross_session_tool_result_reuse",
    name: "Prior tool results from another session are attached to the current context",
    category: "tool-history-bleed",
    severity: "medium",
    owasp: "MCP10:2025",
    recommendation:
      "Replaying lastToolResults / toolHistory across sessions without checking session ownership bleeds one user's tool output into another's prompt. Isolate tool-result caches per session and drop them on session end.",
  },
  {
    id: "vector_query_without_filter",
    name: "Vector/RAG query runs with no metadata filter (tenant/user)",
    category: "unscoped-memory",
    severity: "high",
    owasp: "MCP10:2025",
    recommendation:
      "A similarity search without a where/filter/metadata clause can return embeddings belonging to every tenant in the collection. Always constrain retrieval with tenantId/userId (and KVKK purpose) metadata.",
  },
];

export function checkById(id: string): ContextOvershareCheck {
  const found = CONTEXT_OVERSHARE_CHECKS.find((check) => check.id === id);
  if (!found) throw new Error(`Unknown context-oversharing check: ${id}`);
  return found;
}
