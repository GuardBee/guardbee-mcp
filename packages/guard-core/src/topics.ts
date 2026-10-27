/**
 * Topic detection for policy rules: "conversations about mergers, salaries or
 * unreleased source code must not leave through this agent". A topic is a
 * list of terms; a text is about the topic when at least `minMatches`
 * different terms appear in it.
 *
 * Matching is built for Turkish and English alike: case and the Turkish
 * letters are folded (İ/ı/I → i, ş → s, ğ → g, ü → u, ö → o, ç → c), so
 * "BİRLEŞME", "birlesme" and "Birleşme" are the same word. A term matches at
 * the start of a word and may be followed by a suffix — "maaş" finds
 * "maaşları", "satın alma" finds "satın almayı" — because Turkish adds its
 * grammar to the end of the word. Put a term in double quotes to match the
 * whole word only: `"AI"` finds "AI" but not "AIM".
 */

export interface TopicDefinition {
  id: string;
  description?: string;
  terms: string[];
  /** Different terms that must appear before the text counts as on topic (default 1). */
  minMatches?: number;
}

export interface TopicHit {
  id: string;
  /** The terms that matched, as written in the definition. */
  terms: string[];
}

const FOLD: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" };

/** Lower-case with Turkish rules, then fold the letters that differ from ASCII. */
export function foldText(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ışğüöçâîû]/g, (ch) => FOLD[ch] ?? ch);
}

const WORD = "[\\p{L}\\p{N}]";

function termPattern(term: string): RegExp | null {
  const trimmed = term.trim();
  const exact = trimmed.length > 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  const words = foldText(exact ? trimmed.slice(1, -1) : trimmed)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return null;
  const body = words.join("[\\s\\p{P}]+");
  return new RegExp(`(?<!${WORD})${body}${exact ? `(?!${WORD})` : ""}`, "u");
}

interface CompiledTopic {
  id: string;
  minMatches: number;
  terms: { term: string; pattern: RegExp }[];
}

const cache = new WeakMap<readonly TopicDefinition[], CompiledTopic[]>();

function compile(topics: readonly TopicDefinition[]): CompiledTopic[] {
  let compiled = cache.get(topics);
  if (!compiled) {
    compiled = topics.map((topic) => ({
      id: topic.id,
      minMatches: topic.minMatches ?? 1,
      terms: topic.terms.flatMap((term) => {
        const pattern = termPattern(term);
        return pattern ? [{ term, pattern }] : [];
      }),
    }));
    cache.set(topics, compiled);
  }
  return compiled;
}

/** Every string inside a JSON-like value, for scanning arguments and results. */
export function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringsIn(item, out);
  return out;
}

/** The topics a value is about, in definition order. */
export function detectTopics(value: unknown, topics: readonly TopicDefinition[]): TopicHit[] {
  if (topics.length === 0) return [];
  const text = foldText(stringsIn(value).join("\n"));
  if (text.trim() === "") return [];
  const hits: TopicHit[] = [];
  for (const topic of compile(topics)) {
    const matched = topic.terms.filter(({ pattern }) => pattern.test(text)).map(({ term }) => term);
    if (matched.length >= topic.minMatches) hits.push({ id: topic.id, terms: matched });
  }
  return hits;
}
