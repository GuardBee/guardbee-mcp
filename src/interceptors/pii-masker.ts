// PII patterns for response masking
const PII_PATTERNS: { name: string; pattern: RegExp; replacement: string }[] = [
  {
    name: "tc_kimlik",
    pattern: /\b[1-9]\d{10}\b/g,
    replacement: "[TC-KİMLİK]",
  },
  {
    name: "iban",
    pattern: /\bTR\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{2}\b/gi,
    replacement: "TR**[IBAN]",
  },
  {
    name: "credit_card",
    pattern: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
    replacement: "****-****-****-[KART]",
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

export function maskPiiInText(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    if (typeof replacement === "string") {
      result = result.replace(pattern, replacement);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  return result;
}

export function maskPiiInValue(value: unknown): unknown {
  if (typeof value === "string") {
    return maskPiiInText(value);
  }
  if (Array.isArray(value)) {
    return value.map(maskPiiInValue);
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = maskPiiInValue(v);
    }
    return result;
  }
  return value;
}
