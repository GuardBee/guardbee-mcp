import { createHash } from "crypto";
import { maskPiiInValue } from "@guardbee/guard-core";

/** Consecutive words hashed together; long enough that common phrases rarely collide. */
const SHINGLE = 6;
/**
 * Non-overlapping shingles that must match before a text counts as carried —
 * at least 12 words in common. One shared phrase is not a leak; short values
 * are covered by the pii, id and short-text rules.
 */
const MIN_TEXT_HITS = 2;
/** A single token this long that also has a digit reads as an id, key or hash. */
const MIN_ID_TOKEN = 16;
/** A whole text shorter than a shingle is still remembered when it has 3+ words and is at least this long. */
const MIN_SHORT_TEXT = 15;
/** Text seen from this many different tools is a template or footer, not one source's data. */
const COMMON_SOURCES = 3;
const MAX_PRINTS = 200_000;
const MAX_WORDS_SCANNED = 20_000;

export interface DataMatch {
  /** Tool (or resource) whose result held the data. */
  source: string;
  kind: "pii" | "id" | "text";
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("base64url").slice(0, 16);
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringsIn(item, out);
  return out;
}

function wordsOf(text: string): string[] {
  // Locale-free lowercasing (a "tr" locale turns English "I" into "ı"); drop the dot İ leaves behind
  const lower = text.normalize("NFKC").toLowerCase().replace(/\u0307/g, "");
  return (lower.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_WORDS_SCANNED);
}

/**
 * Text for shingles: without URLs and markdown link/image targets, which are
 * shared boilerplate (badges, registry links). Ids inside URLs are still
 * caught by the id rule, which reads the full text.
 */
function proseOf(text: string): string {
  return text
    .replace(/<[^>]{0,500}>/g, " ")
    .replace(/\]\[[^\]]*\]/g, "] ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ")
    .replace(/\b(?:https?|ftp):\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ");
}

/** Licence texts every codebase repeats; their shingles are never evidence. */
const BOILERPLATE = [
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
  "Licensed under the Apache License, Version 2.0 (the \"License\"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an \"AS IS\" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.",
  "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.",
  "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.",
];

function shinglesOf(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + SHINGLE <= words.length; i++) out.push(words.slice(i, i + SHINGLE).join(" "));
  return out;
}

const COMMON = new Set(BOILERPLATE.flatMap((text) => shinglesOf(wordsOf(proseOf(text)))));

/** A short value worth remembering: 3+ words, two of them real words, not a date or a number list. */
function isDistinctShortText(words: string[]): boolean {
  if (words.length < 3 || words.join(" ").length < MIN_SHORT_TEXT) return false;
  return words.filter((word) => /^\p{L}{3,}$/u.test(word)).length >= 2;
}

/** The same identifier written with or without spaces, dashes or a country prefix. */
function piiKey(pattern: string, match: string): string {
  const compact = match.replace(/[\s.\-()]/g, "").toLowerCase();
  if (pattern === "phone_tr") return `phone:${compact.replace(/\D/g, "").slice(-10)}`;
  return `${pattern}:${compact}`;
}

function piiKeysIn(text: string): string[] {
  const keys: string[] = [];
  maskPiiInValue(text, (pattern, match) => {
    keys.push(piiKey(pattern, match));
    return match;
  });
  return keys;
}

/**
 * Hashed fingerprints of the sensitive data a session's tools returned:
 * personal data and credentials, id-like tokens, and runs of words. An egress
 * call whose arguments match one is carrying that data out — the evidence the
 * data-based taint check looks for. Only hashes are kept, in memory, per session.
 */
export class DataFingerprints {
  private readonly prints = new Map<string, DataMatch>();
  /** Sources per text shingle (up to COMMON_SOURCES), to spot templates repeated across tools. */
  private readonly shingleSources = new Map<string, Set<string>>();
  /** Shingles that also came back in a result that was not sensitive. */
  private readonly ordinary = new Set<string>();

  get size(): number {
    return this.prints.size;
  }

  add(source: string, value: unknown): void {
    for (const text of stringsIn(value)) {
      for (const key of piiKeysIn(text)) this.put(`p:${key}`, { source, kind: "pii" });
      const words = wordsOf(text);
      for (const word of words) {
        if (word.length >= MIN_ID_TOKEN && /\d/.test(word)) this.put(`i:${word}`, { source, kind: "id" });
      }
      const prose = wordsOf(proseOf(text));
      if (prose.length >= SHINGLE) {
        for (const shingle of shinglesOf(prose)) {
          if (COMMON.has(shingle)) continue;
          const key = `t:${shingle}`;
          this.put(key, { source, kind: "text" });
          this.countSource(hash(key), source);
        }
      } else if (isDistinctShortText(prose)) {
        this.put(`s:${prose.length}:${prose.join(" ")}`, { source, kind: "text" });
      }
    }
  }

  /**
   * Remember the text of a result that was not sensitive: a shingle that also
   * appears there (a footer, a signature, a template) is no evidence.
   */
  addOrdinary(value: unknown): void {
    for (const text of stringsIn(value)) {
      for (const shingle of shinglesOf(wordsOf(proseOf(text)))) {
        if (this.ordinary.size >= MAX_PRINTS) return;
        this.ordinary.add(hash(`t:${shingle}`));
      }
    }
  }

  /** The first remembered piece of data found in a value, or null. */
  find(value: unknown): DataMatch | null {
    if (this.prints.size === 0) return null;
    for (const text of stringsIn(value)) {
      for (const key of piiKeysIn(text)) {
        const hit = this.get(`p:${key}`);
        if (hit) return hit;
      }
      const words = wordsOf(text);
      for (const word of words) {
        if (word.length >= MIN_ID_TOKEN && /\d/.test(word)) {
          const hit = this.get(`i:${word}`);
          if (hit) return hit;
        }
      }
      const prose = wordsOf(proseOf(text));
      const hits = new Map<string, { count: number; nextFree: number }>();
      const shingles = shinglesOf(prose);
      for (let position = 0; position < shingles.length; position++) {
        const hashed = hash(`t:${shingles[position]}`);
        const hit = this.prints.get(hashed);
        if (!hit || this.ordinary.has(hashed) || (this.shingleSources.get(hashed)?.size ?? 0) >= COMMON_SOURCES) continue;
        const seen = hits.get(hit.source) ?? { count: 0, nextFree: 0 };
        if (position < seen.nextFree) continue; // overlaps the last counted shingle
        seen.count += 1;
        seen.nextFree = position + SHINGLE;
        if (seen.count >= MIN_TEXT_HITS) return hit;
        hits.set(hit.source, seen);
      }
      // Short sensitive texts: look for them as a word run of the same length
      for (let size = 3; size < SHINGLE; size++) {
        for (let i = 0; i + size <= prose.length; i++) {
          const hit = this.get(`s:${size}:${prose.slice(i, i + size).join(" ")}`);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  private put(key: string, match: DataMatch): void {
    const hashed = hash(key);
    if (this.prints.has(hashed) || this.prints.size >= MAX_PRINTS) return;
    this.prints.set(hashed, match);
  }

  private countSource(hashed: string, source: string): void {
    const sources = this.shingleSources.get(hashed) ?? new Set<string>();
    if (sources.size < COMMON_SOURCES) sources.add(source);
    if (this.shingleSources.size < MAX_PRINTS || this.shingleSources.has(hashed)) this.shingleSources.set(hashed, sources);
  }

  private get(key: string): DataMatch | null {
    return this.prints.get(hash(key)) ?? null;
  }
}
