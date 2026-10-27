/**
 * Unicode look-alikes (fullwidth digits, mathematical bold letters), other
 * scripts' digits (١٢٣, १२३), zero-width characters and character escapes
 * (`&#49;`, `\u0031`, `%40`) inside a value defeat ASCII regex detectors, so
 * detection runs on a normalized copy and masking maps back to the original.
 */

/** Invisible characters an agent can slip inside a value without changing how it reads. */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/;
const INVISIBLE_ALL = new RegExp(INVISIBLE.source, "g");

/** A base character with its combining marks, so NFKC can compose them (I + U+0307 → İ). */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gsu;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0", commat: "@", period: ".", plus: "+", hyphen: "-", lowbar: "_", colon: ":" };

/**
 * One escaped character: an HTML entity, a JS/JSON escape, or a run of URL
 * escapes. A lone `%XX` counts only inside a word ("ahmet%40example"), so
 * "%50 indirim" stays a percentage.
 */
const ESCAPE = new RegExp(
  [
    "&#(\\d{1,7});",
    "&#[xX]([0-9a-fA-F]{1,6});",
    `&(${Object.keys(NAMED).join("|")});`,
    "\\\\u([0-9a-fA-F]{4})",
    "\\\\u\\{([0-9a-fA-F]{1,6})\\}",
    "\\\\x([0-9a-fA-F]{2})",
    "((?:%[0-9a-fA-F]{2}){2,}|(?<=[\\w.~-])%[0-9a-fA-F]{2}(?=[\\w.~-]))",
  ].join("|"),
  "g",
);
const TOKEN = new RegExp(`${ESCAPE.source}|${CLUSTER.source}`, "gsu");

/** A decimal digit outside ASCII (NFKC leaves Arabic-Indic, Devanagari… as they are). */
const OTHER_DIGIT = /(?![0-9])\p{Nd}/u;

/** Its value: each script's digits are a run of ten code points starting at zero. */
function digitValue(char: string): string {
  const code = char.codePointAt(0)!;
  let zero = code;
  while (zero > code - 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--;
  return String((code - zero) % 10);
}

/** Most text needs no work: ASCII without escapes, or already NFKC with nothing invisible. */
export function needsNormalization(text: string): boolean {
  ESCAPE.lastIndex = 0;
  if (ESCAPE.test(text)) return true;
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) return false;
  return INVISIBLE.test(text) || OTHER_DIGIT.test(text) || text.normalize("NFKC") !== text;
}

/** NFKC, other scripts' digits as ASCII, invisible characters dropped. */
function normalizeChar(text: string): string {
  const normalized = text.replace(INVISIBLE_ALL, "").normalize("NFKC");
  return OTHER_DIGIT.test(normalized) ? normalized.replace(new RegExp(OTHER_DIGIT.source, "gu"), digitValue) : normalized;
}

/** A run of URL escapes as characters, each with its span in the run; an invalid UTF-8 byte stays as written. */
function decodePercent(run: string): { char: string; start: number; end: number }[] {
  const bytes = run.match(/%[0-9a-fA-F]{2}/g)!.map((escape) => parseInt(escape.slice(1), 16));
  const out: { char: string; start: number; end: number }[] = [];
  for (let i = 0; i < bytes.length; ) {
    const lead = bytes[i]!;
    const length = lead < 0x80 ? 1 : lead >= 0xc2 && lead < 0xe0 ? 2 : lead >= 0xe0 && lead < 0xf0 ? 3 : lead >= 0xf0 && lead < 0xf5 ? 4 : 0;
    const sequence = bytes.slice(i, i + Math.max(length, 1));
    let char: string | null = null;
    if (length > 0 && sequence.length === length && sequence.slice(1).every((b) => b >= 0x80 && b < 0xc0)) {
      try {
        char = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(sequence));
      } catch {
        char = null;
      }
    }
    const take = char === null ? 1 : length;
    out.push({ char: char ?? run.slice(i * 3, i * 3 + 3), start: i * 3, end: (i + take) * 3 });
    i += take;
  }
  return out;
}

/** What an escape stands for, or null for a code point that does not exist. */
function unescape(match: RegExpMatchArray): string | null {
  const [, decimal, hexEntity, named, u4, uBraced, x2] = match;
  if (named) return NAMED[named]!;
  const code = decimal ? parseInt(decimal, 10) : parseInt((hexEntity ?? u4 ?? uBraced ?? x2)!, 16);
  // A lone \uD83D surrogate still stands for one UTF-16 unit
  if (u4) return String.fromCharCode(code);
  return code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

/** One unit of the working text: where it came from in the original, and whether it is a placeholder. */
interface Unit {
  char: string;
  start: number;
  end: number;
  placeholder: boolean;
}

/**
 * Text being masked: the detectors see `text`, and each of its UTF-16 units
 * remembers the span of the original it came from.
 */
export class NormalizedText {
  private units: Unit[];
  private changed = false;

  constructor(private readonly original: string) {
    this.units = [];
    let pendingStart: number | null = null;
    const push = (normalized: string, start: number, end: number) => {
      if (!normalized) {
        // Invisible: belongs to the character before it, or to the next one at the start.
        const last = this.units[this.units.length - 1];
        if (last) this.extendLast(end);
        else pendingStart ??= start;
        return;
      }
      const from = pendingStart ?? start;
      pendingStart = null;
      for (let i = 0; i < normalized.length; i++) this.units.push({ char: normalized[i]!, start: from, end, placeholder: false });
    };
    for (const match of original.matchAll(TOKEN)) {
      const start = match.index!;
      const end = start + match[0].length;
      const percent = match[7];
      if (percent) {
        for (const char of decodePercent(percent)) push(normalizeChar(char.char), start + char.start, start + char.end);
        continue;
      }
      const escaped = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
      const decoded = escaped === undefined ? match[0] : (unescape(match) ?? match[0]);
      push(normalizeChar(decoded), start, end);
    }
  }

  /** Rebuilt only after a replacement: most detectors match nothing. */
  private cachedText: string | null = null;

  get text(): string {
    return (this.cachedText ??= this.units.map((u) => u.char).join(""));
  }

  /**
   * Run one detector over the working text. `replace` gets the normalized
   * match; returning it unchanged keeps the original spelling.
   */
  replace(pattern: RegExp, replace: (match: string) => string): void {
    const text = this.text;
    const next: Unit[] = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index!;
      const value = match[0];
      if (!value) continue;
      const replacement = replace(value);
      if (replacement === value) continue;
      for (let i = cursor; i < at; i++) next.push(this.units[i]!);
      let start = Infinity;
      let end = 0;
      for (let i = at; i < at + value.length; i++) {
        start = Math.min(start, this.units[i]!.start);
        end = Math.max(end, this.units[i]!.end);
      }
      for (let i = 0; i < replacement.length; i++) next.push({ char: replacement[i]!, start, end, placeholder: true });
      cursor = at + value.length;
      this.changed = true;
    }
    if (cursor === 0) return;
    for (let i = cursor; i < this.units.length; i++) next.push(this.units[i]!);
    this.units = next;
    this.cachedText = null;
  }

  /** The original text with every masked span replaced, everything else in its original spelling. */
  toString(): string {
    if (!this.changed) return this.original;
    let out = "";
    let lastEnd = 0;
    for (const unit of this.units) {
      if (unit.placeholder) {
        out += unit.char;
        lastEnd = Math.max(lastEnd, unit.end);
      } else if (unit.start >= lastEnd) {
        out += this.original.slice(unit.start, unit.end);
        lastEnd = unit.end;
      }
    }
    return out;
  }

  private extendLast(end: number): void {
    // Every unit from the same original cluster shares the span.
    const last = this.units[this.units.length - 1]!;
    const start = last.start;
    for (let i = this.units.length - 1; i >= 0 && this.units[i]!.start === start && !this.units[i]!.placeholder; i--) {
      this.units[i]!.end = end;
    }
  }
}
