export type PatternCategory =
  | "client-exposure" // AI provider credentials/config leaked to the browser
  | "output-handling" // model output treated as trusted code/markup/data
  | "excessive-agency" // agent tools with unchecked real-world side effects
  | "data-privacy" // regulated personal data sent to a third-party model
  | "prompt-injection" // untrusted input mixed into instructions unguarded
  | "cost-control"; // unbounded generation/looping

export interface AiCodePattern {
  id: string;
  name: string;
  category: PatternCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  /** Neden riskli olduğu ve ne yapılması gerektiği — bulgu ile birlikte gösterilir. */
  recommendation: string;
}

/**
 * Bunlar secret-scanner'ın aksine "sızmış bir değer" değil, "riskli bir kullanım
 * kalıbı" arıyor — bu yüzden eşleşen metin redakte edilmez (bir API key değil,
 * bir kod yapısıdır). Regex'ler heuristic'tir: statik bir metin taramasıyla
 * yakalanabilecek en yaygın ve düşük yanlış-pozitifli kalıplara odaklanır,
 * tam bir AST analizi yapmaz.
 */
export const AI_CODE_PATTERNS: AiCodePattern[] = [
  // ── Client exposure ──────────────────────────────────────────────────────────
  {
    id: "openai_dangerously_allow_browser",
    name: "OpenAI client initialized with dangerouslyAllowBrowser",
    category: "client-exposure",
    pattern: /dangerouslyAllowBrowser\s*:\s*true/g,
    severity: "critical",
    recommendation:
      "This ships your OpenAI API key to every visitor's browser. Proxy AI calls through your own backend instead.",
  },
  {
    id: "client_bundled_ai_api_key",
    name: "AI provider API key exposed via a client-bundled env var",
    category: "client-exposure",
    pattern: /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)\w*(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE_AI|COHERE|MISTRAL|GROQ)\w*(?:API_KEY|SECRET|TOKEN)\b/gi,
    severity: "critical",
    recommendation:
      "Env vars with this prefix are bundled into client-side JS by most frameworks (Next.js, Vite, CRA) and are readable by anyone. Keep AI provider keys server-only.",
  },

  // ── Output handling ──────────────────────────────────────────────────────────
  {
    id: "eval_llm_output",
    name: "LLM output passed to eval()/Function()",
    category: "output-handling",
    pattern: /\b(?:eval|new\s+Function)\s*\(\s*[\w$.]*\.(?:choices\[0\]\.message\.content|message\.content|content|text|completion|output_text)\b/g,
    severity: "critical",
    recommendation:
      "Executing model output as code lets a prompt injection become arbitrary code execution. Never eval() a completion; parse it as data with strict validation.",
  },
  {
    id: "exec_llm_output",
    name: "LLM output passed to a shell/process exec call",
    category: "output-handling",
    pattern: /\b(?:exec|execSync|spawn|spawnSync)\s*\(\s*[\w$.]*\.(?:choices\[0\]\.message\.content|message\.content|content|text|completion|output_text)\b/g,
    severity: "critical",
    recommendation:
      "Passing model output to a shell command is command injection via prompt injection. Validate against an allowlist before executing anything derived from a completion.",
  },
  {
    id: "llm_output_dangerously_set_inner_html",
    name: "LLM output rendered via dangerouslySetInnerHTML",
    category: "output-handling",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*[\w$.]*(?:llm|ai|completion|response|answer|reply)\w*/gi,
    severity: "high",
    recommendation:
      "Rendering model output as raw HTML is XSS via prompt injection (the model can be induced to emit <script> tags). Render as text or sanitize with a library like DOMPurify first.",
  },
  {
    id: "llm_json_no_validation",
    name: "LLM output JSON.parse'd without schema validation nearby",
    category: "output-handling",
    pattern: /JSON\.parse\s*\(\s*[\w$.]*\.(?:choices\[0\]\.message\.content|message\.content|content|text|completion|output_text)\b/g,
    severity: "medium",
    recommendation:
      "Models don't reliably produce valid or schema-conforming JSON. Validate parsed output against a schema (zod/ajv) and handle parse failures explicitly.",
  },

  // ── Excessive agency ───────────────────────────────────────────────────────
  {
    id: "excessive_agency_tool_name",
    name: "Agent tool grants shell/arbitrary code execution",
    category: "excessive-agency",
    pattern: /(?:\.tool\(\s*|\bname\s*:\s*)["'](?:run_shell|execute_command|run_command|execute_shell|eval_code|execute_code|run_script|shell_exec)["']/gi,
    severity: "high",
    recommendation:
      "A tool the model can call to run arbitrary shell/code is a critical blast-radius risk if the model is ever manipulated via prompt injection. Restrict to a narrow allowlist of specific, parameterized actions instead.",
  },
  {
    id: "unbounded_agent_loop",
    name: "Agent loop with no visible iteration bound",
    category: "excessive-agency",
    pattern: /\b(?:while\s*\(\s*true\s*\)|for\s*\(\s*;;\s*\))[\s\S]{0,200}?\.(?:chat\.completions\.create|messages\.create)\s*\(/g,
    severity: "medium",
    recommendation:
      "An agent loop with no max-iteration guard can run away on cost (or get stuck in a tool-call cycle). Add an explicit iteration cap.",
  },

  // ── Data privacy ─────────────────────────────────────────────────────────────
  {
    id: "pii_field_in_llm_prompt",
    name: "Field that looks like PII interpolated directly into a prompt",
    category: "data-privacy",
    pattern: /\b(?:content|prompt|text)\s*[:=]\s*[`'"][^`'"]*\$\{[^}]*(?:email|tcKimlik|nationalId|ssn|creditCard|password|phone|address|dateOfBirth)[^}]*\}/gi,
    severity: "high",
    recommendation:
      "Sending regulated personal data (email, national ID, card number, etc.) to a third-party LLM API is a KVKK/GDPR data-transfer concern. Redact or tokenize the field before it enters the prompt.",
  },

  // ── Prompt injection ───────────────────────────────────────────────────────
  {
    id: "unsanitized_input_in_system_prompt",
    name: "Raw request/user input interpolated into a system prompt",
    category: "prompt-injection",
    pattern: /role\s*:\s*["']system["'][\s\S]{0,150}?\$\{\s*(?:req\.|request\.|userInput\b|input\b)/gi,
    severity: "medium",
    recommendation:
      "Untrusted input mixed directly into the system role gives it instruction-level authority. Keep untrusted content in a separate user/data role with clear delimiters, and treat it as data, not instructions.",
  },
];
