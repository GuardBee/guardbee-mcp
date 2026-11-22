/**
 * Readings of a text with the obfuscation an injection hides behind taken off:
 * escapes (HTML entities, URL and JS escapes), look-alike letters from other
 * scripts, invisible characters, hex runs, leetspeak and letter-by-letter
 * spacing. A plain pattern scan sees "1gn0r3 411 pr3v10u5 1n57ruc710n5" or
 * "іgnоrе" (Cyrillic і, о, е) as noise; the model reads them as words.
 *
 * Each reading is produced only when it differs from the text, and only the
 * precise injection rules run on them (see findInjections), so ordinary text
 * that happens to contain a digit or an entity does not start warning.
 */
import { NormalizedText, needsNormalization } from "./normalize.js";

export type Obfuscation = "escapes" | "homoglyphs" | "hex" | "leetspeak" | "spacing";

export interface Deobfuscated {
  how: Obfuscation;
  text: string;
  /** Where the reading starts in the original (runs); 0 for a reading of the whole text. */
  index: number;
}

/**
 * Cyrillic, Greek and Armenian letters that render like Latin ones, and the
 * Latin small capitals and IPA letters attacks use. NFKC leaves all of these
 * as they are. Only one-to-one look-alikes are listed: a letter that merely
 * resembles a Latin one in some fonts would turn real Cyrillic or Greek text
 * into Latin noise and is not worth the false matches.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  ѕ: "s", і: "i", ї: "i", ј: "j", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w", ү: "y", ӏ: "l",
  А: "A", В: "B", Е: "E", Ё: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
  Ѕ: "S", І: "I", Ї: "I", Ј: "J", Һ: "H", Ԁ: "D", Ԛ: "Q", Ԝ: "W", Ү: "Y", Ӏ: "I",
  // Greek
  α: "a", ο: "o", ρ: "p", ν: "v", τ: "t", υ: "u", ι: "i", κ: "k", χ: "x",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  // Armenian
  օ: "o", ս: "u", հ: "h", ո: "n", ց: "g", ք: "q",
  // Latin small capitals and IPA
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ғ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m", ɴ: "n",
  ᴏ: "o", ᴘ: "p", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z", ɑ: "a", ɡ: "g", ı: "i",
};
const CONFUSABLE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu");

/** A word that mixes Latin letters with look-alikes: an attacker's spelling, not a word of another language. */
const MIXED_WORD = /\p{L}+/gu;

function unconfuse(text: string): string {
  return text.replace(MIXED_WORD, (word) => {
    CONFUSABLE.lastIndex = 0;
    if (word.length < 3 || !CONFUSABLE.test(word)) return word;
    // A Latin letter among look-alikes is a disguise. A word with none is another language, unless every
    // letter has a Latin twin and it is long enough to be a word ("ехесutе" typed in Cyrillic and Greek)
    const disguised = /[A-Za-z]/.test(word) || (word.length >= 4 && [...word].every((char) => CONFUSABLES[char] !== undefined));
    return disguised ? word.replace(CONFUSABLE, (char) => CONFUSABLES[char] ?? char) : word;
  });
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i", "|": "l", "+": "t" };
/** A token with letters and leet characters mixed ("1gn0r3", "pr3v!0us"); plain numbers and words are left alone. */
const LEET_TOKEN = /(?<![\w@$!|+])(?=[\w@$!|+]*[A-Za-z])(?=[\w@$!|+]*[0134578@$!|+9])[\w@$!|+]{3,}/g;

function unleet(text: string): string {
  return text.replace(LEET_TOKEN, (token) => {
    // Long runs are identifiers, hashes and encodings, not words
    if (token.length > 24) return token;
    return token.replace(/[0134578@$!|+9]/g, (char) => LEET[char] ?? char);
  });
}

/** Four or more single letters, each joined to the next by one to three separators ("i g n o r e", "i.g.n.o.r.e"). */
const SPACED = /(?<![\p{L}\p{N}])\p{L}(?:[ .\-_*·]{1,3}\p{L}){3,}(?![\p{L}\p{N}])/gu;

function unspace(text: string): string {
  // Within a spaced-out phrase, a wider gap (two or more separators) is the gap between words
  return text.replace(SPACED, (run) =>
    run
      .split(/[ .\-_*·]{2,}/u)
      .map((word) => word.replace(/[ .\-_*·]/gu, ""))
      .join(" "),
  );
}

/** A hex dump of text: an even number of hex digits, at least 24 (12 bytes), optionally with \x or 0x prefixes or spaces. */
const HEX_RUN = /(?<![0-9A-Za-z])(?:(?:\\x|0x)?[0-9a-fA-F]{2}[ :]?){12,}(?![0-9A-Za-z])/g;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function hexRuns(text: string): Deobfuscated[] {
  const out: Deobfuscated[] = [];
  for (const match of text.matchAll(HEX_RUN)) {
    const digits = match[0].replace(/\\x|0x|[ :]/g, "");
    // Text bytes (0x20–0x7E) always put a digit in the high nibble; a run of letters a–f is a word
    if (digits.length % 2 !== 0 || !/\d/.test(digits)) continue;
    let decoded: string;
    try {
      decoded = UTF8.decode(Buffer.from(digits, "hex"));
    } catch {
      continue;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(decoded) || decoded.replace(/[^\p{L}\s]/gu, "").length < decoded.length * 0.6) continue;
    out.push({ how: "hex", text: decoded, index: match.index ?? 0 });
    if (out.length >= 50) break;
  }
  return out;
}

/** At most this much text gets the whole-text readings: past it, an attacker gains nothing a chunked scan would miss. */
const MAX_LENGTH = 200_000;

export function deobfuscatedReadings(text: string): Deobfuscated[] {
  if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH);
  const readings: Deobfuscated[] = [];
  const add = (how: Obfuscation, reading: string) => {
    if (reading !== text && !readings.some((r) => r.text === reading)) readings.push({ how, text: reading, index: 0 });
  };

  // Escapes, NFKC (fullwidth, mathematical letters) and invisible characters, the same reading PII detection uses
  const unescaped = needsNormalization(text) ? new NormalizedText(text).text : text;
  add("escapes", unescaped);
  const latin = unconfuse(unescaped);
  add("homoglyphs", latin);
  // Leetspeak and spacing on top of the cleaned text: "1gn0r3" in fullwidth digits is still leet
  add("leetspeak", unleet(latin));
  add("spacing", unspace(latin));
  add("spacing", unspace(unleet(latin)));
  readings.push(...hexRuns(text));
  return readings;
}
