export type ScanResult =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "warn"; reason: string };

export type InjectionCategory =
  | "instruction-override" // content tells the model to ignore its prior instructions
  | "role-spoofing" // content fakes a system/chat-template turn to gain instruction authority
  | "hidden-text" // the payload is hidden from a human reviewer but reaches the model
  | "direct-address" // content addresses "the AI" directly — a strong signal it targets a model, not a human reader
  | "exfiltration"; // content tries to make the model leak data or its own instructions

export interface InjectionRule {
  id: string;
  name: string;
  category: InjectionCategory;
  /** Always global (`g`): callers iterate matches. */
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  /** Why it is risky and what to do — shown with a finding. */
  recommendation: string;
  /**
   * A generic phrase that also shows up in ordinary text ("act as", "developer
   * mode"). Never blocks a call, only warns; the static scanner skips it.
   */
  broad?: boolean;
}

/**
 * Content that will reach a model: a tool result, a RAG chunk, a scraped page.
 * Regexes are heuristics that aim for few false positives, not an intent model.
 * The precise rules come from prompt-injection-scanner; the broad ones are the
 * phrases security-proxy 0.x blocked on.
 */
export const INJECTION_RULES: InjectionRule[] = [
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
  {
    id: "instruction_override_tr",
    name: "Content tells the model, in Turkish, to ignore its prior instructions",
    category: "instruction-override",
    pattern: /(?<!\p{L})(?:önceki|yukarıdaki|tüm|bütün)\s+(?:talimatları|talimatlar[ıi]n[ıi]|kuralları|yönergeleri|komutları)\s+(?:yok\s+say|unut|görmezden\s+gel|dikkate\s+alma|umursama)/giu,
    severity: "high",
    recommendation:
      "The Turkish form of an instruction-override phrase ('önceki talimatları yok say'). Pattern lists written only in English miss it. Treat the content as untrusted input and keep it out of the model's instructions.",
  },
  {
    id: "dan_mode",
    name: "Content switches the model into 'DAN mode'",
    category: "instruction-override",
    pattern: /\bDAN\s+mode\b/gi,
    severity: "high",
    recommendation:
      "'DAN mode' is a well-known jailbreak persona with no use in ordinary content. Quarantine content that asks for it.",
  },
  {
    id: "you_are_now",
    name: "Content assigns the model a new identity ('you are now …')",
    category: "instruction-override",
    pattern: /\byou\s+are\s+now\s+(?:a\s+)?(?!an?\s+AI\b|a\s+language\b)/gi,
    severity: "medium",
    broad: true,
    recommendation: "Often part of a role-override injection, but also common in ordinary writing. Review the surrounding text.",
  },
  {
    id: "act_as",
    name: "Content asks the model to act as something else",
    category: "instruction-override",
    pattern: /\bact\s+as\s+(?:if\s+you\s+are\s+)?(?!an?\s+AI\b|a\s+language\b)/gi,
    severity: "medium",
    broad: true,
    recommendation: "Often part of a role-override injection, but also common in ordinary writing ('act as a proxy'). Review the surrounding text.",
  },
  {
    id: "pretend_to_be",
    name: "Content asks the model to pretend to be something else",
    category: "instruction-override",
    pattern: /\bpretend\s+(?:you\s+are|to\s+be)\s+(?!an?\s+AI\b|a\s+language\b)/gi,
    severity: "medium",
    broad: true,
    recommendation: "Often part of a role-override injection. Review the surrounding text.",
  },
  {
    id: "role_override_tr",
    name: "Content assigns the model a new identity, in Turkish ('sen artık …')",
    category: "instruction-override",
    pattern: /(?<!\p{L})(?:sen\s+artık|bundan\s+sonra\s+sen)\s+(?=\p{L})/giu,
    severity: "medium",
    broad: true,
    recommendation: "Often part of a role-override injection, but also ordinary Turkish. Review the surrounding text.",
  },
  {
    id: "jailbreak_word",
    name: "Content mentions a jailbreak",
    category: "instruction-override",
    pattern: /\bjailbreak(?:ing|s)?\b/gi,
    severity: "medium",
    broad: true,
    recommendation: "Articles about LLM security use this word too; on its own it is a weak signal.",
  },
  {
    id: "developer_mode",
    name: "Content asks for a 'developer mode'",
    category: "instruction-override",
    pattern: /\bdeveloper\s+mode\b/gi,
    severity: "medium",
    broad: true,
    recommendation: "A common jailbreak framing, and a common phrase in software documentation.",
  },
  {
    id: "bypass_safety",
    name: "Content tells the model to bypass its safety measures",
    category: "instruction-override",
    pattern: /\b(?:bypass|override|disable)\s+(?:the\s+|your\s+|all\s+)?(?:safety|safeguards?|guardrails?|content\s+filters?)\b/gi,
    severity: "high",
    recommendation: "Content that tells a model to switch off its safety measures is an injection attempt. Quarantine it.",
  },
  {
    id: "bypass_policy",
    name: "Content mentions bypassing a filter, restriction or policy",
    category: "instruction-override",
    pattern: /\b(?:bypass|override)\s+(?:the\s+)?(?:filters?|restrictions?|polic(?:y|ies))\b/gi,
    severity: "medium",
    broad: true,
    recommendation: "An injection phrase, but also everyday IT language ('override policy settings').",
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
  {
    id: "system_tag",
    name: "Content wraps text in a <system> tag",
    category: "role-spoofing",
    pattern: /<\s*\/?\s*system\s*>/gi,
    severity: "high",
    recommendation: "A <system> tag in data tries to pass the text off as a system message. Strip or escape it before the content reaches a model.",
  },
  {
    id: "system_prompt_label",
    name: "Content contains a 'system prompt:' label",
    category: "role-spoofing",
    pattern: /\bsystem\s+prompt\s*:/gi,
    severity: "medium",
    broad: true,
    recommendation: "May introduce a fake system prompt; also appears in documentation about prompts.",
  },
  {
    id: "system_bracket",
    name: "Content contains a [SYSTEM] marker",
    category: "role-spoofing",
    pattern: /\[SYSTEM\]/gi,
    severity: "medium",
    broad: true,
    recommendation: "May fake a system turn; also used as a log-level tag.",
  },

  // ── Hidden text ──────────────────────────────────────────────────────────────
  {
    id: "hidden_zero_width_chars",
    name: "Zero-width characters that hide text from a human reviewer",
    category: "hidden-text",
    pattern: /[​⁠]/g,
    severity: "medium",
    recommendation:
      "Zero-width space/word-joiner characters render invisibly but are still read by a model. They're a common way to hide an injection payload from someone eyeballing the document while it still reaches the model. Inspect the surrounding text for hidden content, and consider stripping these characters before ingestion.",
  },
  {
    id: "unicode_tag_smuggling",
    name: "Invisible Unicode tag characters (ASCII smuggling)",
    category: "hidden-text",
    // A run of tag characters, except the one legitimate use: a subdivision flag
    // emoji (🏴 + 1–6 lowercase/digit tags + CANCEL TAG, e.g. England). A run that
    // starts after a flag or a tag is part of that flag; text hidden after a
    // complete flag still matches through the second branch.
    pattern:
      /(?<![\u{1F3F4}\u{E0000}-\u{E007F}])[\u{E0000}-\u{E007F}]+|\u{1F3F4}(?![\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,6}\u{E007F}(?![\u{E0000}-\u{E007F}]))[\u{E0000}-\u{E007F}]+/gu,
    severity: "critical",
    recommendation:
      "Unicode tag characters (U+E0000–U+E007F) mirror ASCII but render as nothing. Text encoded in them is invisible to a person and readable by many models — a known way to smuggle instructions. Apart from subdivision flag emoji, ordinary text never needs them; strip them before the content reaches a model.",
  },
  {
    id: "bidi_control_chars",
    name: "Bidirectional control characters that reorder displayed text",
    category: "hidden-text",
    pattern: /[‪-‮⁦-⁩]/g,
    severity: "medium",
    recommendation:
      "Bidi embedding/override characters make text display in a different order than it is read (the 'Trojan Source' technique). Right-to-left languages rarely need the override forms; check what the text says once the controls are removed.",
  },
  {
    id: "css_hidden_text_with_instruction",
    name: "CSS-hidden element containing injection-flavored language",
    category: "hidden-text",
    // `color` alone, not `background-color`; the language must read as an instruction,
    // not just contain "ignore" (as in `<!-- prettier-ignore -->`).
    pattern: /style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px)?|(?<![\w-])color\s*:\s*(?:white|#fff(?:fff)?\b|transparent))[^"']*["'][\s\S]{0,200}?(?:(?<![\w-])(?:ignore|disregard)\s+(?:all|any|the|previous|prior|above|earlier|your|these|those|everything)\b|\bsystem\s+prompt\b|\b(?:your|previous|prior)\s+instructions\b|\b(?:AI|assistant|LLM|chatbot)\s*:|\b(?:you|the)\s+(?:AI|assistant|LLM|model)\b)/gi,
    severity: "high",
    recommendation:
      "This element is hidden from a rendered page (display:none / zero font-size / white-on-white) but a scraper feeding a RAG pipeline still extracts its text — and it contains injection-flavored language. Strip hidden elements before extracting text for a model, or render the page and use only the visible text.",
  },
  {
    id: "html_comment_instruction",
    name: "HTML comment containing injection-flavored language",
    category: "hidden-text",
    pattern: /<!--[\s\S]{0,300}?(?:(?<![\w-])(?:ignore|disregard)\s+(?:all|any|the|previous|prior|above|earlier|your|these|those|everything)\b|\bsystem\s+prompt\b|\b(?:your|previous|prior)\s+instructions\b|\b(?:AI|assistant|LLM|chatbot)\s*:|\b(?:you|the)\s+(?:AI|assistant|LLM|model)\b)[\s\S]{0,300}?-->/gi,
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
    id: "reveal_system_prompt_tr",
    name: "Content asks the model, in Turkish, to reveal its system prompt",
    category: "exfiltration",
    pattern: /(?:sistem\s+(?:istemini|promptunu|talimatlarını|mesajını)|gizli\s+talimatlarını|ilk\s+talimatlarını)\s+(?:göster|yaz|söyle|tekrarla|paylaş|ver)/giu,
    severity: "high",
    recommendation: "The Turkish form of a prompt-extraction phrase. Instruct the model never to disclose its instructions, whatever retrieved content asks.",
  },
  {
    id: "reveal_instructions",
    name: "Content asks the model to print its instructions",
    category: "exfiltration",
    pattern: /\b(?:reveal|print)\s+(?:your\s+)?(?:instructions|prompt)\b/gi,
    severity: "medium",
    broad: true,
    recommendation: "May be a prompt-extraction attempt; also appears in developer documentation.",
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

/** @deprecated The bare regexes of INJECTION_RULES; use INJECTION_RULES. */
export const INJECTION_PATTERNS: RegExp[] = INJECTION_RULES.map((rule) => rule.pattern);

export interface InjectionFinding {
  ruleId: string;
  name: string;
  category: InjectionCategory;
  severity: InjectionRule["severity"];
  broad: boolean;
  match: string;
  index: number;
  /** Set when the phrase was found inside a decoded base64 run. */
  encoding?: "base64";
}

const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;
const MAX_BASE64_RUNS = 50;

/** Decoded text of base64 runs that decode to readable text; binary blobs are skipped. */
function decodedBase64Runs(text: string): { text: string; index: number }[] {
  const runs: { text: string; index: number }[] = [];
  for (const match of text.matchAll(BASE64_RUN)) {
    if (runs.length >= MAX_BASE64_RUNS) break;
    const decoded = Buffer.from(match[0], "base64").toString("utf8");
    const readable = decoded.replace(/[^\x20-\x7E\s -￿]/g, "").length;
    if (decoded.length >= 12 && readable / decoded.length > 0.9 && !decoded.includes("�")) {
      runs.push({ text: decoded, index: match.index ?? 0 });
    }
  }
  return runs;
}

function matchRules(text: string, rules: readonly InjectionRule[], offset = 0, encoding?: "base64"): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const rule of rules) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        ruleId: rule.id,
        name: rule.name,
        category: rule.category,
        severity: rule.severity,
        broad: rule.broad === true,
        match: match[0],
        index: offset + (match.index ?? 0),
        ...(encoding ? { encoding } : {}),
      });
    }
  }
  return findings;
}

/**
 * Every rule match in the text, plus precise-rule matches inside base64 runs
 * that decode to text (an instruction hidden from both the reader and a plain
 * pattern scan).
 */
export function findInjections(text: string): InjectionFinding[] {
  const precise = INJECTION_RULES.filter((rule) => !rule.broad);
  const findings = matchRules(text, INJECTION_RULES);
  for (const run of decodedBase64Runs(text)) findings.push(...matchRules(run.text, precise, run.index, "base64"));
  return findings;
}

/** All string leaves, newline-joined, so line-anchored rules still see line starts inside JSON. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, out);
  else if (value !== null && value !== undefined) out.push(String(value));
  return out;
}

function describe(finding: InjectionFinding): string {
  return `${finding.ruleId}${finding.encoding ? " (base64-encoded)" : ""} — ${finding.name}`;
}

const BLOCKING: ReadonlySet<InjectionRule["severity"]> = new Set(["high", "critical"]);

/**
 * A precise high/critical rule → `mode` (block or warn). A broad or medium
 * rule alone → warn, never block.
 */
export function scanForPromptInjection(
  input: unknown,
  mode: "block" | "warn" = "block",
): ScanResult {
  const findings = findInjections(collectStrings(input).join("\n"));
  const blocking = findings.find((finding) => !finding.broad && BLOCKING.has(finding.severity));
  if (blocking) {
    return { action: mode, reason: `Prompt injection pattern detected: ${describe(blocking)}` };
  }
  const first = findings[0];
  if (first) return { action: "warn", reason: `Possible prompt injection (not blocked): ${describe(first)}` };
  return { action: "allow" };
}

/** Same rules as request scanning, applied to a tool result the model will read. */
export function scanToolResult(content: unknown, mode: "block" | "warn" = "block"): ScanResult {
  const result = scanForPromptInjection(content, mode);
  if (result.action === "allow") return result;
  return {
    action: result.action,
    reason: `Indirect prompt injection in tool result (MCP06:2025): ${result.reason}`,
  };
}
