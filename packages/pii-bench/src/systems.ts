import { maskPiiInText } from "@guardbee/guard-core";

/** One span a system flags; `category` is its own name for it (guard-core's detector name). */
export interface Detection {
  start: number;
  end: number;
  category: string;
}

/** A detector under test. Add a system (NER, Presidio, an LLM prompt) by implementing this. */
export interface System {
  name: string;
  description: string;
  detect(text: string): Detection[] | Promise<Detection[]>;
}

const OPEN = "";
const CLOSE = "";
const MARK = /([-])/g;

/**
 * guard-core masks text rather than reporting spans. The replacer swaps each
 * match for a private-use marker, and walking the output back against the
 * matches recovers where each one was. A match a later pattern swallowed
 * (it holds a marker) is expanded, and the swallowed one kept as its own span.
 */
export function guardCoreSpans(text: string): Detection[] {
  const found: { name: string; match: string }[] = [];
  const masked = maskPiiInText(text, (name, match) => {
    found.push({ name, match });
    return OPEN + String.fromCharCode(0xe100 + found.length - 1) + CLOSE;
  });

  const detections: Detection[] = [];
  const walk = (value: string, base: number): string => {
    let original = "";
    let cursor = 0;
    for (const marker of value.matchAll(MARK)) {
      original += value.slice(cursor, marker.index);
      cursor = marker.index + marker[0].length;
      const { name, match } = found[marker[1]!.charCodeAt(0) - 0xe100]!;
      const start = base + original.length;
      const inner = walk(match, start);
      detections.push({ start, end: start + inner.length, category: name });
      original += inner;
    }
    return original + value.slice(cursor);
  };
  // A text that needed Unicode normalization hands the replacer the normalized match
  if (walk(masked, 0) !== text) throw new Error("could not map guard-core matches back onto the text");
  return detections.sort((a, b) => a.start - b.start);
}

export const SYSTEMS: Record<string, System> = {
  "guard-core-regex": {
    name: "guard-core-regex",
    description: "@guardbee/guard-core maskPiiInText, default detectors (regex + checksum validation)",
    detect: guardCoreSpans,
  },
};
