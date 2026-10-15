/**
 * Unicode look-alikes (fullwidth digits, mathematical bold letters) and
 * zero-width characters inside a value defeat ASCII regex detectors, so
 * detection runs on a normalized copy and masking maps back to the original.
 */

/** Invisible characters an agent can slip inside a value without changing how it reads. */
const INVISIBLE = /[­᠎​-‏⁠-⁤﻿]/;
const INVISIBLE_ALL = new RegExp(INVISIBLE.source, "g");

/** A base character with its combining marks, so NFKC can compose them (I + U+0307 → İ). */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gsu;

/** Most text needs no work: ASCII, or already NFKC with nothing invisible. */
export function needsNormalization(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) return false;
  return INVISIBLE.test(text) || text.normalize("NFKC") !== text;
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
    for (const match of original.matchAll(CLUSTER)) {
      const start = match.index!;
      const end = start + match[0].length;
      const normalized = match[0].replace(INVISIBLE_ALL, "").normalize("NFKC");
      if (!normalized) {
        // Invisible: belongs to the character before it, or to the next one at the start.
        const last = this.units[this.units.length - 1];
        if (last) this.extendLast(end);
        else pendingStart ??= start;
        continue;
      }
      const from = pendingStart ?? start;
      pendingStart = null;
      for (let i = 0; i < normalized.length; i++) this.units.push({ char: normalized[i]!, start: from, end, placeholder: false });
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
