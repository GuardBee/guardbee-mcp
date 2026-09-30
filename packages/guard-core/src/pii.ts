import { SECRET_RULES } from "./secrets.js";
import { isValidIban, isValidLuhn, isValidTcKimlik, isValidTrPhone, isValidVkn } from "./validators.js";

export interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  /** Checksum run on each regex match; a match that fails it is left as-is. */
  validate?: (rawMatch: string) => boolean;
}

const REPLACEMENT_BY_SECRET: Record<string, string> = {
  jwt: "[JWT-TOKEN]",
  db_url_postgres: "[CONNECTION-STRING]",
  db_url_mysql: "[CONNECTION-STRING]",
  db_url_mongodb: "[CONNECTION-STRING]",
  db_url_redis: "[CONNECTION-STRING]",
};

/**
 * Masking must cover the whole secret, where detection only needs a prefix:
 * the scanner's Slack rule stops at the first `-`, which would leave the rest
 * of `xoxb-<team>-<bot>-<secret>` in the output.
 */
const MASK_PATTERN_BY_SECRET: Record<string, RegExp> = {
  slack_token: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
};

/** Provider formats from the secret scanner, minus the broad ones; each keeps its allowlist. */
const SECRET_PATTERNS: PiiPattern[] = SECRET_RULES.filter((rule) => !rule.broad).map((rule) => ({
  name: rule.id,
  pattern: MASK_PATTERN_BY_SECRET[rule.id] ?? rule.pattern,
  replacement: REPLACEMENT_BY_SECRET[rule.id] ?? "[API-KEY]",
  ...(rule.allowlist ? { validate: (match: string) => !rule.allowlist!.some((allow) => allow.test(match)) } : {}),
}));

// Order matters: earlier patterns mask first, so later ones never see their digits.
// Secrets run first — a key or connection string holds digit runs that would
// otherwise be half-masked as a phone or card number.
export const PII_PATTERNS: PiiPattern[] = [
  {
    // The whole block, not just the BEGIN line the code scanner reports.
    name: "private_key",
    pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    replacement: "[PRIVATE-KEY]",
  },
  ...SECRET_PATTERNS,
  {
    // Unknown providers: a key-like prefix, a separator, then a run with both letters and digits.
    name: "api_key",
    pattern: /\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{16,}\b/gi,
    replacement: "[API-KEY]",
    validate: (match) => {
      const value = match.replace(/^[A-Za-z]+[-_]/, "");
      return /[A-Za-z]/.test(value) && /\d/.test(value);
    },
  },
  {
    name: "tc_kimlik",
    pattern: /\b[1-9]\d{10}\b/g,
    replacement: "[TC-KİMLİK]",
    validate: isValidTcKimlik,
  },
  {
    // A bare 10-digit number is too common to call a tax number; require the label.
    name: "vkn",
    pattern: /(?<=\b(?:VKN|V\.K\.N\.?|[Vv]ergi\s+(?:[Kk]imlik\s+)?[Nn](?:o|umaras[ıi])\.?)\s*[:#]?\s*)\d{10}(?!\d)/g,
    replacement: "[VKN]",
    validate: isValidVkn,
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
    // Not glued to letters, `/` or `-` (ids in URLs), and either written with a
    // +90 / 0 prefix or grouped with spaces/dashes: a bare 10-digit run is more
    // often an id or an integer IP (2130706433) than a phone number.
    pattern: /(?<![\w+/.#-])(?:(?:\+90|0090|0)[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\w/-])/g,
    replacement: "+90-***-***-**[TELEFON]",
    validate: (match) => isValidTrPhone(match) && (/^(?:\+90|0)/.test(match) || /[\s-]/.test(match)),
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
