import { NormalizedText, needsNormalization } from "./normalize.js";
import type { OrgPatterns } from "./org-patterns.js";
import { SECRET_RULES } from "./secrets.js";
import { SPECIAL_CATEGORY_REPLACEMENT, findSpecialTerms, mentionsPerson } from "./special.js";
import { isValidIban, isValidLuhn, isValidTcKimlik, isValidTrPhone, isValidVkn } from "./validators.js";

export interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  /** Checksum run on each regex match; a match that fails it is left as-is. */
  validate?: (rawMatch: string) => boolean;
  /**
   * Off unless asked for by name (`include`): network identifiers and plates
   * are everywhere in infrastructure output, where masking them would break
   * the tool more than it protects anyone.
   */
  optIn?: boolean;
}

/** Personal data categories (the rest of PII_PATTERNS are credentials). */
export const PERSONAL_DATA_CATEGORIES = [
  "tc_kimlik",
  "vkn",
  "iban",
  "credit_card",
  "email",
  "phone_tr",
  "passport",
  "sgk_no",
  "mersis",
  "kep",
  "birth_date",
  "address",
  "ip_address",
  "mac_address",
  "plate_tr",
] as const;

export const OPT_IN_PII = ["ip_address", "mac_address", "plate_tr"] as const;

/**
 * Personal data no regex finds: a model does (the NER backend in
 * @guardbee/ner). Its spans come in through `SpanLookup`; without one these
 * detectors find nothing.
 */
export const MODEL_PII = ["person_name"] as const;

/** What a model-found value is replaced with, unless the replacer says otherwise. */
export const MODEL_PII_REPLACEMENT: Record<(typeof MODEL_PII)[number], string> = {
  person_name: "[KİŞİ]",
};

/** One value a model found in a text: offsets into that text, and the detector name. */
export interface ModelSpan {
  start: number;
  end: number;
  detector: string;
}

/**
 * The spans a model found in a text, looked up by the text itself: models run
 * asynchronously, masking does not, so the caller runs the model over every
 * string first and masking asks for each one's result. A lookup that has no
 * result for a text must throw, never return nothing: an unscanned text
 * passed as clean is the silent fallback masking must not make.
 */
export type SpanLookup = (text: string) => readonly ModelSpan[];

/** A model that finds personal data in texts: one list of spans per text, in order. */
export interface ModelDetector {
  detect(texts: readonly string[]): Promise<ModelSpan[][]>;
}

/**
 * The whitespace-delimited run around a span holds an e-mail address or a URL:
 * a regex detector masks that whole, where masking the name inside first
 * would break its match and leave the rest of the address out.
 */
function insideAddress(text: string, start: number, end: number): boolean {
  let from = start;
  let to = end;
  while (from > 0 && !/\s/.test(text[from - 1]!)) from--;
  while (to < text.length && !/\s/.test(text[to]!)) to++;
  return /@|:\/\//.test(text.slice(from, to));
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
    // Label-gated: "Pasaport No: U12345678", "Passport number 123456789"
    name: "passport",
    pattern: /(?<=\b(?:pasaport|passport)(?:\s+(?:no|numaras[ıi]|number|#))?\.?\s*[:#]?\s*)(?:[A-Z]{1,2}\d{6,8}|\d{9})(?![A-Za-z0-9])/gi,
    replacement: "[PASAPORT]",
  },
  {
    // Label-gated: SGK / SSK / Bağ-Kur registration numbers
    name: "sgk_no",
    pattern: /(?<=\b(?:SGK|SSK|Ba[ğg]-?Kur)\s*(?:sicil\s*)?(?:no|numaras[ıi])?\.?\s*[:#]?\s*)\d{7,13}(?!\d)/gi,
    replacement: "[SGK-NO]",
  },
  {
    // Label-gated: 16-digit MERSİS company number (before cards: 16 digits)
    name: "mersis",
    pattern: /(?<=\bMERS[İIıi]S\s*(?:no|numaras[ıi])?\.?\s*[:#]?\s*)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/gi,
    replacement: "[MERSİS]",
  },
  {
    // Label-gated: "Doğum tarihi: 12.05.1990", "DOB 1990-05-12"
    name: "birth_date",
    pattern: /(?<=\b(?:do[ğg]um\s+tarihi|date\s+of\s+birth|birth\s*date|DOB)\s*[:#]?\s*)(?:\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2})(?!\d)/gi,
    replacement: "[DOĞUM-TARİHİ]",
  },
  {
    // Label-gated, with a colon, the rest of the line: "Adres: Atatürk Mah. 12. Sok. No:5"
    // Not "IP address:", "E-mail address:", "Web address:", "Wallet address:".
    name: "address",
    pattern: /(?<=(?<!\b(?:IP|MAC|e-?mail|web|wallet|billing\s+e-?mail|server|host)\s)\b(?:adres(?:i)?|ikametgah|address)\s*:\s*)\S[^\n]{7,199}/gi,
    replacement: "[ADRES]",
    // A street address has a number or a street word; a URL or a handle is not one
    validate: (match) =>
      !/^\s*(?:https?:|www\.|@|0x)/i.test(match) &&
      (/\d/.test(match) || /\b(?:mah(?:alle(?:si)?)?|sok(?:ak|a[ğg]ı)?|cad(?:de(?:si)?)?|bulvar(?:ı)?|street|st\.|avenue|ave\.|road|rd\.|apt|daire|kat)\b/i.test(match)),
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
    // Registered e-mail (KEP), before plain e-mail
    name: "kep",
    pattern: /\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)*kep\.tr\b/gi,
    replacement: "***@[KEP]",
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
  {
    name: "mac_address",
    pattern: /(?<![\w:-])[0-9A-F]{2}([:-])[0-9A-F]{2}(?:\1[0-9A-F]{2}){4}(?![\w:-])/gi,
    replacement: "[MAC]",
    optIn: true,
  },
  {
    name: "ip_address",
    // IPv4 with valid octets, not part of a longer dotted run (1.2.3.4.5, a version string)
    pattern: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.])|(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi,
    replacement: "[IP]",
    optIn: true,
    // IPv6 needs "::" or all eight groups, so a time like 12:30:45 is not one
    validate: (match) => match.includes(".") || ((match.includes("::") || match.split(":").length === 8) && /[0-9a-f]/i.test(match)),
  },
  {
    // 34 ABC 123 — 1 letter + 4-5 digits, 2 letters + 3-4, 3 letters + 2-3; no Q, W, X
    name: "plate_tr",
    pattern: /(?<![\w-])(?:0[1-9]|[1-7]\d|8[01])\s?[A-PR-VYZ]{1,3}\s?\d{2,5}(?![\w-])/g,
    replacement: "[PLAKA]",
    optIn: true,
    validate: (match) => {
      const parts = /^\d{2}\s?([A-Z]+)\s?(\d+)$/.exec(match);
      if (!parts) return false;
      const [letters, digits] = [parts[1]!.length, parts[2]!.length];
      if (/^(?:GB|MB|KB|TB|PB|GHZ|MHZ|KM|CM|MM|KG|TL|MS|HZ|FPS|DPI|PX|PT|UTC|GMT)$/.test(parts[1]!)) return false;
      return (letters === 1 && digits >= 4) || (letters === 2 && digits >= 3 && digits <= 4) || (letters === 3 && digits <= 3);
    },
  },
];

/**
 * Returns what a validated match is replaced with. Returning `undefined` keeps
 * the default: the pattern's fixed placeholder, or `<CATEGORY_n>` for an org
 * block pattern. Returning the match unchanged leaves it unmasked.
 */
export type PiiReplacer = (patternName: string, match: string) => string | undefined;

/**
 * Which detectors run: a plain set turns on opt-in detectors by name
 * (ip_address, mac_address, plate_tr) next to the default ones; a scope from
 * `piiScope()` (any set with `exact: true`) runs exactly the detectors in it.
 */
export type PiiInclude = ReadonlySet<string> & { readonly exact?: boolean };

function runs(name: string, optIn: boolean | undefined, include: PiiInclude | undefined): boolean {
  if (include?.exact) return include.has(name);
  return !optIn || include?.has(name) === true;
}

/** Model-found values, replaced before the regex detectors run (whose placeholders a model may misread). */
function maskModelSpans(text: string, spans: SpanLookup | undefined, replace: PiiReplacer | undefined, include: PiiInclude | undefined): string {
  const found = spans?.(text);
  if (!found || found.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const { start, end, detector } of [...found].sort((a, b) => a.start - b.start)) {
    if (start < cursor || end <= start || end > text.length || !runs(detector, false, include) || insideAddress(text, start, end)) continue;
    const match = text.slice(start, end);
    const fallback = MODEL_PII_REPLACEMENT[detector as keyof typeof MODEL_PII_REPLACEMENT] ?? "[REDACTED]";
    out += text.slice(cursor, start) + (replace?.(detector, match) ?? fallback);
    cursor = end;
  }
  return out + text.slice(cursor);
}

const PERSONAL = new Set<string>(PERSONAL_DATA_CATEGORIES);

/**
 * The context rule for the special categories: the text names someone (the
 * model found a name), holds a personal identifier, or has a word that points
 * at a person.
 */
let identifiers: { pattern: RegExp; validate?: PiiPattern["validate"] }[] | undefined;

function aboutPerson(text: string, spans: SpanLookup | undefined): boolean {
  if (spans?.(text).some((span) => span.detector === "person_name")) return true;
  // Global copies, made once: matchAll needs the g flag
  identifiers ??= PII_PATTERNS.filter((p) => PERSONAL.has(p.name) && !p.optIn).map(({ pattern, validate }) => ({
    pattern: new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`),
    ...(validate ? { validate } : {}),
  }));
  for (const { pattern, validate } of identifiers) {
    for (const match of text.matchAll(pattern)) if (!validate || validate(match[0])) return true;
  }
  return mentionsPerson(text);
}

/** KVKK Art. 6 terms in `text` (already masked by the other detectors), when `original` is about a person. */
function maskSpecial(text: string, original: string, replace: PiiReplacer | undefined, include: PiiInclude | undefined, spans: SpanLookup | undefined): string {
  const found = findSpecialTerms(text, (category) => runs(category, true, include));
  if (found.length === 0 || !aboutPerson(original, spans)) return text;
  let out = "";
  let cursor = 0;
  for (const { start, end, detector } of found) {
    const match = text.slice(start, end);
    out += text.slice(cursor, start) + (replace?.(detector, match) ?? SPECIAL_CATEGORY_REPLACEMENT[detector]);
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** Built-in detectors only. */
function maskBuiltIn(text: string, replace: PiiReplacer | undefined, include: PiiInclude | undefined, spans?: SpanLookup): string {
  const original = text;
  text = maskModelSpans(text, spans, replace, include);
  const masked = (name: string, replacement: string, validate: PiiPattern["validate"]) => (match: string) =>
    validate && !validate(match) ? match : (replace?.(name, match) ?? replacement);

  if (needsNormalization(text)) {
    // Detect on the NFKC copy without invisible characters; `replace` sees the
    // normalized value, so every spelling of a value gets the same token.
    const working = new NormalizedText(text);
    for (const { name, pattern, replacement, validate, optIn } of PII_PATTERNS) {
      if (!runs(name, optIn, include)) continue;
      working.replace(pattern, masked(name, replacement, validate));
    }
    return maskSpecial(working.toString(), original, replace, include, spans);
  }

  let result = text;
  for (const { name, pattern, replacement, validate, optIn } of PII_PATTERNS) {
    if (!runs(name, optIn, include)) continue;
    result = result.replace(pattern, masked(name, replacement, validate));
  }
  return maskSpecial(result, original, replace, include, spans);
}

/** Every string in a value, depth first; `fn` returns its replacement. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) result[k] = mapStrings(v, fn);
    return result;
  }
  return value;
}

/**
 * Mask validated PII with the detectors `include` selects (see `PiiInclude`).
 * `org` adds an organization's block and allow patterns (see `OrgPatterns`);
 * it may throw `PiiPatternTimeoutError`, and then nothing may go out.
 * `spans` adds what a model found in each string (see `SpanLookup`).
 */
export function maskPiiInText(text: string, replace?: PiiReplacer, include?: PiiInclude, org?: OrgPatterns, spans?: SpanLookup): string {
  return maskPiiInValue(text, replace, include, org, spans) as string;
}

export function maskPiiInValue(value: unknown, replace?: PiiReplacer, include?: PiiInclude, org?: OrgPatterns, spans?: SpanLookup): unknown {
  if (!org || org.empty) return mapStrings(value, (text) => maskBuiltIn(text, replace, include, spans));

  // 1. Which detected values an allow pattern exempts, decided for all of them in one pass
  let exempt = new Map<string, string>();
  if (org.hasAllow) {
    const detected = new Set<string>();
    mapStrings(value, (text) => maskBuiltIn(text, (_name, match) => (detected.add(match), match), include, spans));
    exempt = org.allowed([...detected]);
  }

  // 2. Built-in detectors, minus the exempt values
  const builtIn = mapStrings(value, (text) =>
    maskBuiltIn(
      text,
      (name, match) => {
        const pattern = exempt.get(match);
        if (pattern === undefined) return replace?.(name, match);
        org.noteAllowed(pattern, name);
        return match;
      },
      include,
      spans,
    ),
  );
  if (!org.hasBlock) return builtIn;

  // 3. Block patterns on what is left: a built-in detection always wins an overlap
  const texts: string[] = [];
  mapStrings(builtIn, (text) => (texts.push(text), text));
  const matches = org.blockMatches(texts);
  const numbers = new Map<string, Map<string, number>>();
  const numbered = (category: string, match: string) => {
    let seen = numbers.get(category);
    if (!seen) numbers.set(category, (seen = new Map()));
    if (!seen.has(match)) seen.set(match, seen.size + 1);
    return `<${category}_${seen.get(match)}>`;
  };
  let index = 0;
  return mapStrings(builtIn, (text) => {
    const found = matches[index++]!;
    if (found.length === 0) return text;
    let out = "";
    let cursor = 0;
    for (const { start, end, category } of found) {
      const match = text.slice(start, end);
      out += text.slice(cursor, start) + (replace?.(category, match) ?? numbered(category, match));
      cursor = end;
    }
    return out + text.slice(cursor);
  });
}
