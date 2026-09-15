export type InjectionCategory =
  | "instruction-override" // content tells the model to ignore its prior instructions
  | "role-spoofing" // content fakes a system/chat-template turn to gain instruction authority
  | "hidden-text" // the payload is hidden from a human reviewer but reaches the model
  | "direct-address" // content addresses "the AI" directly — a strong signal it targets a model, not a human reader
  | "exfiltration"; // content tries to make the model leak data or its own instructions

export interface InjectionPattern {
  id: string;
  name: string;
  category: InjectionCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  /** Neden riskli olduğu ve ne yapılması gerektiği — bulgu ile birlikte gösterilir. */
  recommendation: string;
}

/**
 * `ai-code-scanner`/`mcp-server-auditor`'ın aksine bu paket KOD değil,
 * **içerik** tarar: bir RAG chunk'ı, scrape edilmiş bir web sayfası, bir PDF'ten
 * çıkarılmış metin. Amaç, bu içerik bir LLM'in context'ine (RAG retrieval,
 * tool sonucu, web fetch) girdiğinde modele "talimat" gibi görünecek gömülü
 * bir payload olup olmadığını yakalamak — klasik prompt injection'ın aksine
 * saldırgan modele değil, modelin OKUYACAĞI VERİYE yazar (indirect / dolaylı).
 * Regex'ler heuristic'tir; düşük yanlış-pozitifli kalıplara odaklanır, tam bir
 * semantik/niyet analizi yapmaz.
 */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  // ── Instruction override ────────────────────────────────────────────────────
  {
    id: "instruction_override_phrase",
    name: "Content tells the model to ignore its prior instructions",
    category: "instruction-override",
    pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?|context|directives?)\b/gi,
    severity: "high",
    recommendation:
      "This document contains a classic instruction-override phrase. If it enters a model's context via RAG retrieval or a tool result, it can hijack the model's behavior for the rest of the turn. Strip or quarantine this content before it reaches the model, or wrap retrieved content in clear data delimiters the model is instructed to never treat as commands.",
  },

  // ── Role spoofing ────────────────────────────────────────────────────────────
  {
    id: "system_role_spoof",
    name: "Content fakes a 'System:' role label",
    category: "role-spoofing",
    pattern: /(?:^|\n)\s*(?:#{1,3}\s*)?SYSTEM\s*:\s*\S/gim,
    severity: "medium",
    recommendation:
      "A line formatted like a chat-template system turn ('System: ...') inside retrieved content can trick a model (or a naive prompt-assembly step) into treating it as a real system instruction. Verify this is legitimate document content, not an injection attempt, before trusting it in a RAG/context pipeline.",
  },
  {
    id: "chat_template_marker_injection",
    name: "Raw chat-template control tokens embedded in content",
    category: "role-spoofing",
    pattern: /<\|(?:im_start|im_end|system|endoftext)\|>|\[INST\]|\[\/INST\]/g,
    severity: "high",
    recommendation:
      "Literal chat-template control tokens (e.g. <|im_start|>, [INST]) have no legitimate reason to appear in ordinary document content. If a model's tokenizer doesn't strip these, embedded tokens can hijack the conversation structure itself. Strip or escape these sequences before this content enters any model context.",
  },

  // ── Hidden text ──────────────────────────────────────────────────────────────
  {
    id: "hidden_zero_width_chars",
    name: "Zero-width characters that hide text from a human reviewer",
    category: "hidden-text",
    pattern: /[\u200B\u2060]/g,
    severity: "medium",
    recommendation:
      "Zero-width space/word-joiner characters render invisibly but are still read by a model. They're a common way to hide an injection payload from someone eyeballing the document while it still reaches the model. Inspect the surrounding text for hidden content, and consider stripping these characters before ingestion.",
  },
  {
    id: "css_hidden_text_with_instruction",
    name: "CSS-hidden element containing injection-flavored language",
    category: "hidden-text",
    pattern: /style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px)?|color\s*:\s*(?:white|#fff{3,6}|transparent))[^"']*["'][\s\S]{0,200}?\b(?:ignore|disregard|instructions?|assistant|system prompt|AI)\b/gi,
    severity: "high",
    recommendation:
      "This element is hidden from a rendered page (display:none / zero font-size / white-on-white) but a scraper feeding a RAG pipeline still extracts its text — and it contains injection-flavored language. Strip hidden elements before extracting text for a model, or render the page and use only the visible text.",
  },
  {
    id: "html_comment_instruction",
    name: "HTML comment containing injection-flavored language",
    category: "hidden-text",
    pattern: /<!--[\s\S]{0,300}?\b(?:ignore|disregard|instructions?|assistant|system prompt|AI)\b[\s\S]{0,300}?-->/gi,
    severity: "high",
    recommendation:
      "HTML comments are invisible when a page is rendered but are usually still present in scraped/extracted text. This comment contains language associated with instruction injection. Strip HTML comments before feeding scraped content to a model.",
  },

  // ── Direct address ────────────────────────────────────────────────────────────
  {
    id: "direct_address_to_ai",
    name: "Content directly addresses 'the AI' or 'the assistant'",
    category: "direct-address",
    pattern: /\b(?:dear|hey|attention|note to)\s+(?:the\s+)?(?:AI|assistant|chatbot|language model|LLM)\b/gi,
    severity: "medium",
    recommendation:
      "An ordinary document doesn't address 'the AI' or 'the assistant' directly — this phrasing strongly suggests the content was written to be read and obeyed by a model rather than a human. Treat this document as untrusted input, not as a source of instructions.",
  },

  // ── Exfiltration ──────────────────────────────────────────────────────────────
  {
    id: "exfiltration_url_template_in_image",
    name: "Markdown image URL with a template placeholder (data-exfil beacon)",
    category: "exfiltration",
    pattern: /!\[[^\]]*\]\(\s*https?:\/\/[^)]*(?:\{\{[^}]*\}\}|\$\{[^}]*\})[^)]*\)/g,
    severity: "high",
    recommendation:
      "A markdown image URL containing a template placeholder ({{...}} or ${...}) is a classic exfiltration beacon: a client that auto-renders the image will fetch this URL, and anything the model interpolated into the placeholder (conversation text, secrets) leaks to whoever controls that domain. Never let a model auto-render an image URL it (or retrieved content) constructed.",
  },
  {
    id: "reveal_system_prompt_request",
    name: "Content asks the model to reveal its system prompt or instructions",
    category: "exfiltration",
    pattern: /\b(?:reveal|show|print|output|repeat)\s+(?:your\s+)?(?:system\s+prompt|initial\s+instructions|hidden\s+instructions)\b/gi,
    severity: "high",
    recommendation:
      "This is a standard prompt-extraction phrase. If it's embedded in retrieved content (not typed by the user), a model that processes/summarizes this document may leak its own system prompt or configuration in the response. Instruct the model to never disclose its instructions regardless of what retrieved content asks.",
  },
  {
    id: "send_data_to_url_instruction",
    name: "Content instructs the model to send data to an external URL",
    category: "exfiltration",
    pattern: /\b(?:send|post|submit|forward|email)\s+(?:the\s+)?(?:user'?s?|conversation|chat|this)\s+(?:data|information|details|history)\s+to\s+https?:\/\//gi,
    severity: "critical",
    recommendation:
      "This content explicitly instructs the model to exfiltrate conversation/user data to an external URL — a direct data-exfiltration attempt via indirect prompt injection. Quarantine this content and never grant a model that processes untrusted retrieved content unsupervised network/tool access.",
  },
];
