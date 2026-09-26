export type MemoryPoisoningCategory = "memory-write" | "memory-readback";

export interface MemoryPoisoningPattern {
  id: string;
  name: string;
  category: MemoryPoisoningCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * Ordinary conversation-buffer memory (LangChain's ConversationBufferMemory,
 * a simple chat-history array, ...) holding raw user turns is completely
 * normal — that's just conversation history, not a vulnerability. The risk
 * this package targets is narrower and higher-stakes: writes to *persistent,
 * cross-session* memory (MemGPT-style archival/core memory, or a vector
 * store used as a long-term knowledge base) that will later be recalled and
 * fed back as *trusted context* — the model's own "memory of the world" —
 * potentially in a completely unrelated future session, to a different user,
 * long after whoever planted the content is gone. That's a stored/second-order
 * prompt injection, structurally the same gap between reflected and stored
 * XSS: `prompt-injection-scanner` catches an injection payload sitting in
 * content the model reads once; this catches the code pattern that lets an
 * injection payload become part of what the model treats as its own
 * knowledge, indefinitely.
 */
export const MEMORY_POISONING_PATTERNS: MemoryPoisoningPattern[] = [
  // ── Memory write: untrusted input persisted without visible sanitization ──
  {
    id: "archival_memory_insert_raw_input",
    name: "Raw input written to MemGPT-style archival memory",
    category: "memory-write",
    pattern: /\barchival_memory_insert\s*\(\s*(?:input|params|args|req\.body|request\.body|userInput|message\.content)\b/gi,
    severity: "critical",
    recommendation: "Archival memory is recalled across future, unrelated sessions as trusted background knowledge. Writing raw untrusted input here — instead of a sanitized/validated value — lets one session plant an instruction that surfaces as \"fact\" in someone else's conversation later.",
  },
  {
    id: "core_memory_write_raw_input",
    name: "Raw input written to MemGPT-style core memory",
    category: "memory-write",
    pattern: /\bcore_memory_(?:append|replace)\s*\(\s*[^,)]*,\s*(?:input|params|args|req\.body|request\.body|userInput|message\.content)\b/gi,
    severity: "critical",
    recommendation: "Core memory is re-injected into the system prompt on every single turn by design — it is the highest-trust, most persistent context an agent has. Writing raw untrusted input into it is close to direct system-prompt injection, just delayed.",
  },
  {
    id: "vector_store_add_raw_input",
    name: "Vector store add/upsert fed directly from untrusted input",
    category: "memory-write",
    pattern: /\.(?:add_texts|addTexts|add_documents|addDocuments|upsert)\s*\(\s*(?:input|params|args|req\.body|request\.body|userInput)\b/gi,
    severity: "high",
    recommendation: "A vector store used as an agent's long-term/RAG memory will surface whatever is written here to future retrievals, potentially in unrelated sessions. Validate/sanitize (or at minimum scan with a prompt-injection detector) before persisting untrusted content as retrievable memory.",
  },
  {
    id: "generic_named_memory_write_raw_input",
    name: "A variable/store named like long-term memory is written directly from untrusted input",
    category: "memory-write",
    pattern: /\b(?:long[_-]?term[_-]?memory|knowledge[_-]?base|agent[_-]?memory)\w*\.(?:add|insert|save|store|append|upsert|write)\s*\(\s*(?:input|params|args|req\.body|request\.body|userInput)\b/gi,
    severity: "medium",
    recommendation: "This looks like a write into persistent/long-term memory rather than ordinary short-lived conversation history. If it can later be recalled as trusted context, treat it the same as writing to a system prompt — validate or sanitize first.",
  },

  // ── Memory read-back: recalled content fed to the model as trusted context ──
  {
    id: "archival_memory_feeds_trusted_role",
    name: "Archival memory search result feeds a system/assistant-role message shortly after",
    category: "memory-readback",
    pattern: /\barchival_memory_search\s*\([^)]*\)[\s\S]{0,300}?\brole\s*:\s*["'](?:system|assistant)["']/gi,
    severity: "critical",
    recommendation: "Recalled archival memory is being fed into a system/assistant-role message — the highest-trust context a model has. If anything was ever planted into archival memory without validation, this is where it cashes out as an instruction the model treats as its own.",
  },
  {
    id: "vector_retrieval_feeds_trusted_role",
    name: "Vector store retrieval result feeds a system/assistant-role message shortly after",
    category: "memory-readback",
    pattern: /\.(?:similaritySearch|similarity_search|query|retrieve)\s*\([^)]*\)[\s\S]{0,300}?\brole\s*:\s*["'](?:system|assistant)["']/gi,
    severity: "high",
    recommendation: "A retrieval result is flowing into a system/assistant-role message rather than an ordinary user/tool-result turn. Anything planted in this store earlier — by a prior user, a scraped document, another agent — now speaks with system-level authority.",
  },
  {
    id: "memory_retrieval_feeds_prompt_template",
    name: "Memory/vector retrieval result is interpolated directly into a prompt template",
    category: "memory-readback",
    pattern: /\b(?:memory|vectorstore|vector_store)\.(?:search|get|query|retrieve|similaritySearch|similarity_search)\s*\([^)]*\)[\s\S]{0,200}?\bprompt\s*[:=][\s\S]{0,150}?\$\{/gi,
    severity: "high",
    recommendation: "A memory/vector retrieval result is being interpolated directly into a prompt template with no visible validation step in between. Treat recalled memory content as untrusted data, the same as any other RAG chunk, before it enters a prompt.",
  },
];
