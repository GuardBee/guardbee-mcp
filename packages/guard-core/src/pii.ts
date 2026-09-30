import { isValidIban, isValidLuhn, isValidTcKimlik } from "./validators.js";

export interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  /** Checksum run on each regex match; a match that fails it is left as-is. */
  validate?: (rawMatch: string) => boolean;
}

// Order matters: earlier patterns mask first, so later ones never see their digits.
export const PII_PATTERNS: PiiPattern[] = [
  {
    name: "tc_kimlik",
    pattern: /\b[1-9]\d{10}\b/g,
    replacement: "[TC-KİMLİK]",
    validate: isValidTcKimlik,
  },
  {
    name: "iban",
    pattern: /\bTR\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{2}\b/gi,
    replacement: "TR**[IBAN]",
    validate: isValidIban,
  },
  {
    name: "credit_card",
    pattern: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
    replacement: "****-****-****-[KART]",
    validate: isValidLuhn,
  },
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "***@[EMAIL]",
  },
  {
    name: "phone_tr",
    pattern: /\b(?:\+90|0090|0)?[\s-]?(?:\d{3})[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
    replacement: "+90-***-***-**[TELEFON]",
  },
  {
    name: "api_key",
    pattern: /\b(?:sk|pk|api|key|token|secret)[-_]?[A-Za-z0-9]{16,}\b/gi,
    replacement: "[API-KEY]",
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: "[JWT-TOKEN]",
  },
];

/** Returns what a validated match is replaced with; defaults to the pattern's fixed placeholder. */
export type PiiReplacer = (patternName: string, match: string) => string;

export function maskPiiInText(text: string, replace?: PiiReplacer): string {
  let result = text;
  for (const { name, pattern, replacement, validate } of PII_PATTERNS) {
    result = result.replace(pattern, (match) =>
      validate && !validate(match) ? match : replace ? replace(name, match) : replacement,
    );
  }
  return result;
}

export function maskPiiInValue(value: unknown, replace?: PiiReplacer): unknown {
  if (typeof value === "string") {
    return maskPiiInText(value, replace);
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskPiiInValue(item, replace));
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = maskPiiInValue(v, replace);
    }
    return result;
  }
  return value;
}
