/**
 * Secrets in no known format: a random-looking value assigned to a name that
 * says secret. The provider rules miss these (an internal service key, a
 * webhook signing secret, a salt), and generic_secret_assignment only sees
 * quoted values after a few keywords. Randomness (Shannon entropy) is what
 * separates a key from a word, so the bar is set per character set.
 */

export interface EntropyHit {
  /** Offset of the value in the text. */
  index: number;
  value: string;
  name: string;
  entropy: number;
}

/** Bits per character. */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const SECRET_WORD = /(?:secret|token|passw(?:or)?d|pwd|api_?key|apikey|private_?key|signing_?key|access_?key|auth|credential|salt|webhook_?key|encryption_?key|client_?key|master_?key)/i;
const NOT_SECRET = /(?:public|publishable|pub_?key|hash|checksum|sha\d*|digest|_id$|^id$|uuid|url|uri|path|file|name|version|commit|ref$|prefix|header|type|length|ttl|expir|timeout|count|format|algorithm|mode)/i;

// name = value, name: value, "name": "value" — the value unquoted or quoted
const ASSIGNMENT =
  /(?:^|[\s,{;(])["']?([A-Za-z_][A-Za-z0-9_.-]{1,60})["']?\s*(?::|=|:=|=>)\s*["'`]?([A-Za-z0-9+/=_.-]{20,512})(?=["'`]?(?:[\s,;)}\]]|$))/gm;

const HEX = /^[0-9a-f]+$/i;

function classes(value: string): number {
  return Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/[0-9]/.test(value));
}

/** Random enough to be a key: hex needs length, other sets need a mix of classes and more bits. */
export function looksRandom(value: string): { random: boolean; entropy: number } {
  const entropy = shannonEntropy(value);
  if (HEX.test(value)) return { random: value.length >= 32 && entropy >= 3.0, entropy };
  // A dotted identifier (com.example.app) or a slug is a word, not a key
  if (/^[a-z]+(?:[._-][a-z]+)+$/i.test(value)) return { random: false, entropy };
  // Generated keys almost always hold a digit; a camel-case passphrase does not and
  // still reaches ~3.9 bits, so a value without digits must clear a higher bar
  const threshold = /[0-9]/.test(value) ? 3.7 : 4.4;
  return { random: classes(value) >= 2 && entropy >= threshold, entropy };
}

export function findHighEntropy(text: string): EntropyHit[] {
  const hits: EntropyHit[] = [];
  const re = new RegExp(ASSIGNMENT.source, ASSIGNMENT.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1]!;
    const value = m[2]!;
    if (!SECRET_WORD.test(name) || NOT_SECRET.test(name)) continue;
    const { random, entropy } = looksRandom(value);
    if (!random) continue;
    hits.push({ index: m.index + m[0].lastIndexOf(value), value, name, entropy });
  }
  return hits;
}
