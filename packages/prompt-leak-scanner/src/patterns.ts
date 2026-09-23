export type LeakCategory = "credential" | "financial-pii" | "national-id" | "contact-pii";

export interface LeakPattern {
  id: string;
  name: string;
  category: LeakCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  recommendation: string;
  /** Extra checksum/structure validation beyond the regex, to keep false positives low. */
  validate?: (rawMatch: string) => boolean;
}

// ── Checksum validators ──────────────────────────────────────────────────────

/** Turkish national ID (TC Kimlik No) checksum — the standard 11-digit algorithm. */
function isValidTcKimlik(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11 || d[0] === "0") return false;
  const digits = d.split("").map(Number);
  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7];
  const d10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  const first10Sum = digits.slice(0, 10).reduce((a, b) => a + b, 0);
  const d11 = first10Sum % 10;
  return d10 === digits[9] && d11 === digits[10];
}

/** Luhn checksum for credit card numbers. */
function isValidLuhn(raw: string): boolean {
  const d = raw.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let digit = Number(d[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** IBAN mod-97 checksum (ISO 7064 MOD97-10), computed in chunks to avoid precision loss. */
function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = "";
  for (const ch of numeric) {
    remainder = (Number(remainder + ch) % 97).toString();
  }
  return Number(remainder) === 1;
}

// ── Patterns ──────────────────────────────────────────────────────────────────

export const LEAK_PATTERNS: LeakPattern[] = [
  // ── Credentials — sending these to a third-party LLM is a direct secret leak ──
  {
    id: "openai_api_key",
    name: "OpenAI API key",
    category: "credential",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
    severity: "critical",
    recommendation: "Never let an API key flow into a prompt. Strip it before the request leaves your application, and rotate the key — it may already have been sent to a third party.",
  },
  {
    id: "anthropic_api_key",
    name: "Anthropic API key",
    category: "credential",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    severity: "critical",
    recommendation: "Never let an API key flow into a prompt. Strip it before the request leaves your application, and rotate the key.",
  },
  {
    id: "aws_access_key_id",
    name: "AWS access key ID",
    category: "credential",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: "critical",
    recommendation: "An AWS access key in a prompt is a direct cloud-account compromise risk. Strip it and rotate the key immediately.",
  },
  {
    id: "github_pat",
    name: "GitHub personal access token",
    category: "credential",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/g,
    severity: "critical",
    recommendation: "Strip GitHub tokens before they reach a prompt, and revoke/rotate this one.",
  },
  {
    id: "slack_token",
    name: "Slack token",
    category: "credential",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    severity: "critical",
    recommendation: "Strip Slack tokens before they reach a prompt, and rotate this one.",
  },
  {
    id: "google_api_key",
    name: "Google API key",
    category: "credential",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "critical",
    recommendation: "Strip Google API keys before they reach a prompt, and rotate this one.",
  },
  {
    id: "stripe_secret_key",
    name: "Stripe secret key",
    category: "credential",
    pattern: /\bsk_live_[0-9a-zA-Z]{24,}\b/g,
    severity: "critical",
    recommendation: "A live Stripe secret key in a prompt is a direct payments-account compromise risk. Strip it and rotate the key immediately.",
  },
  {
    id: "private_key_block",
    name: "PEM private key block",
    category: "credential",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g,
    severity: "critical",
    recommendation: "A private key must never enter a prompt. Strip it and rotate/reissue the key pair.",
  },
  {
    id: "jwt_token",
    name: "JWT (JSON Web Token)",
    category: "credential",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    severity: "high",
    recommendation: "A JWT often carries session/identity claims. Strip it before the request leaves your application.",
  },

  // ── Financial PII ─────────────────────────────────────────────────────────────
  {
    id: "credit_card_number",
    name: "Credit card number",
    category: "financial-pii",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    severity: "high",
    recommendation: "Card numbers sent to a third-party LLM are a PCI-DSS and KVKK/GDPR data-transfer concern. Redact or tokenize before the prompt is built.",
    validate: isValidLuhn,
  },
  {
    id: "iban",
    name: "IBAN",
    category: "financial-pii",
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    severity: "high",
    recommendation: "An IBAN is regulated financial PII. Redact or tokenize before the prompt is built.",
    validate: isValidIban,
  },

  // ── National ID ───────────────────────────────────────────────────────────────
  {
    id: "tc_kimlik_no",
    name: "Turkish national ID (TC Kimlik No)",
    category: "national-id",
    pattern: /\b\d{11}\b/g,
    severity: "high",
    recommendation: "A validated TC Kimlik No is regulated personal data under KVKK. Redact or tokenize before the prompt is built.",
    validate: isValidTcKimlik,
  },

  // ── Contact PII ───────────────────────────────────────────────────────────────
  {
    id: "email_address",
    name: "Email address",
    category: "contact-pii",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    severity: "medium",
    recommendation: "Consider whether the model needs the real email address, or a placeholder/tokenized reference would do.",
  },
  {
    id: "turkish_phone_number",
    name: "Turkish phone number",
    category: "contact-pii",
    pattern: /\b(?:\+90|0)\s?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g,
    severity: "medium",
    recommendation: "Consider whether the model needs the real phone number, or a placeholder/tokenized reference would do.",
  },
];
