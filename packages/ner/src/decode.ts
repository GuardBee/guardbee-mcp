import type { ModelSpan } from "@guardbee/guard-core";

/** Where a token sits in the text; `piece` marks a word-piece that continues the previous token's word. */
export interface TokenOffset {
  start: number;
  end: number;
  piece: boolean;
}

const SPECIAL = /^(?:\[(?:CLS|SEP|PAD|UNK|MASK)\]|<\/?s>|<pad>|<unk>|<mask>)$/;
/** How far ahead of the last token a token may start: whitespace, or characters the tokenizer dropped. */
const MAX_GAP = 32;

/**
 * The tokenizer reports tokens, not offsets: find each token in the text,
 * moving forward. BERTurk is cased and keeps accents, so a token is the text
 * itself; a word-piece is marked `##` (WordPiece), or a word start `▁`
 * (SentencePiece, XLM-R). A token the text does not hold where expected
 * ([UNK], a character the tokenizer normalized) gets no offset and the next
 * one is looked for from the same place.
 */
export function alignTokens(text: string, tokens: readonly string[]): (TokenOffset | null)[] {
  const sentencePiece = tokens.some((token) => token.startsWith("▁"));
  const folded = text.toLocaleLowerCase("tr");
  // Case folding that changes a string's length would shift offsets: search the text itself then
  const canFold = folded.length === text.length;
  const offsets: (TokenOffset | null)[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (SPECIAL.test(token)) {
      offsets.push(null);
      continue;
    }
    const piece = sentencePiece ? !token.startsWith("▁") : token.startsWith("##");
    const value = sentencePiece ? token.replace(/^▁/, "") : piece ? token.slice(2) : token;
    if (sentencePiece && !value) {
      // A lone word-start marker: the next token starts a word
      offsets.push(null);
      continue;
    }
    let at = value ? text.indexOf(value, cursor) : -1;
    if ((at < 0 || at - cursor > MAX_GAP) && canFold && value) at = folded.indexOf(value.toLocaleLowerCase("tr"), cursor);
    if (at < 0 || at - cursor > MAX_GAP) {
      offsets.push(null);
      continue;
    }
    offsets.push({ start: at, end: at + value.length, piece });
    cursor = at + value.length;
  }
  return offsets;
}

/**
 * BIO labels to spans of the entity types kept (`types` maps a model type,
 * PER, to a detector name, person_name). A word-piece takes its word's label;
 * I- continues the open entity; so does a B- of the same type right after a
 * space, since models often tag a surname B-PER. Anything else closes it, so
 * a case suffix after an apostrophe (Yılmaz'ın) stays out of the span.
 */
export function decodeEntities(text: string, offsets: readonly (TokenOffset | null)[], labels: readonly string[], types: Readonly<Record<string, string>>): ModelSpan[] {
  const spans: ModelSpan[] = [];
  let open: ModelSpan | null = null;
  const close = () => {
    if (open) spans.push(open);
    open = null;
  };
  for (const [i, offset] of offsets.entries()) {
    if (!offset) continue;
    const label = labels[i] ?? "O";
    const detector = label === "O" ? undefined : types[label.slice(2)];
    if (offset.piece) {
      if (open) open.end = offset.end;
      continue;
    }
    const current = open as ModelSpan | null;
    if (current && detector === current.detector && (label.startsWith("I-") || /^\s+$/.test(text.slice(current.end, offset.start)))) {
      current.end = offset.end;
      continue;
    }
    close();
    if (detector) open = { start: offset.start, end: offset.end, detector };
  }
  close();
  return spans;
}

export interface Window {
  /** First token of the window, in the text's token list. */
  start: number;
  end: number;
  /** The tokens this window decides: the middle, away from edges a neighbour covers better. */
  ownStart: number;
  ownEnd: number;
}

/**
 * A text longer than the model's input runs in overlapping windows. Each
 * token's label comes from the one window that owns it, the one where it is
 * furthest from a cut, so a name split by a window edge is still seen whole.
 */
export function windows(count: number, size: number, overlap: number): Window[] {
  if (count <= size) return [{ start: 0, end: count, ownStart: 0, ownEnd: count }];
  const step = size - overlap;
  const result: Window[] = [];
  for (let start = 0; ; start += step) {
    const end = Math.min(start + size, count);
    const last = end === count;
    result.push({ start, end, ownStart: start === 0 ? 0 : start + Math.floor(overlap / 2), ownEnd: last ? count : end - Math.ceil(overlap / 2) });
    if (last) break;
  }
  return result;
}
