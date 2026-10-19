import { describe, expect, it } from "vitest";
import { alignTokens, decodeEntities, windows } from "../decode.js";

const TYPES = { PER: "person_name" };
const spansOf = (text: string, tokens: string[], labels: string[]) =>
  decodeEntities(text, alignTokens(text, tokens), labels, TYPES).map((span) => text.slice(span.start, span.end));

describe("alignTokens", () => {
  it("places WordPiece tokens, marking word-pieces", () => {
    const text = "Ayşe Yılmaz'ın raporu";
    expect(alignTokens(text, ["Ayşe", "Yılmaz", "'", "ın", "rap", "##oru"])).toEqual([
      { start: 0, end: 4, piece: false },
      { start: 5, end: 11, piece: false },
      { start: 11, end: 12, piece: false },
      { start: 12, end: 14, piece: false },
      { start: 15, end: 18, piece: false },
      { start: 18, end: 21, piece: true },
    ]);
  });

  it("skips special and unknown tokens, and carries on after them", () => {
    const text = "Ali ✪ Veli";
    expect(alignTokens(text, ["[CLS]", "Ali", "[UNK]", "Veli", "[SEP]"])).toEqual([null, { start: 0, end: 3, piece: false }, null, { start: 6, end: 10, piece: false }, null]);
  });

  it("places SentencePiece tokens, where ▁ starts a word", () => {
    const text = "Ayşe Yılmaz";
    expect(alignTokens(text, ["<s>", "▁Ay", "şe", "▁Yılmaz", "</s>"])).toEqual([null, { start: 0, end: 2, piece: false }, { start: 2, end: 4, piece: true }, { start: 5, end: 11, piece: false }, null]);
  });

  it("finds a token whose case the tokenizer changed", () => {
    expect(alignTokens("AYŞE", ["ayşe"])).toEqual([{ start: 0, end: 4, piece: false }]);
  });
});

describe("decodeEntities", () => {
  it("joins B-PER I-PER, and a surname tagged B-PER after a space", () => {
    expect(spansOf("Ayşe Yılmaz geldi", ["Ayşe", "Yılmaz", "geldi"], ["B-PER", "I-PER", "O"])).toEqual(["Ayşe Yılmaz"]);
    expect(spansOf("Ayşe Yılmaz geldi", ["Ayşe", "Yılmaz", "geldi"], ["B-PER", "B-PER", "O"])).toEqual(["Ayşe Yılmaz"]);
  });

  it("leaves the case suffix after an apostrophe out", () => {
    expect(spansOf("Kemal'in raporu", ["Kemal", "'", "in", "raporu"], ["B-PER", "O", "O", "O"])).toEqual(["Kemal"]);
  });

  it("extends a name over its word-pieces, whatever label they got", () => {
    expect(spansOf("Gökçenur geldi", ["Gök", "##çe", "##nur", "geldi"], ["B-PER", "O", "I-PER", "O"])).toEqual(["Gökçenur"]);
  });

  it("keeps only the types asked for, and splits names a comma separates", () => {
    expect(spansOf("Ali, Veli Ankara'da", ["Ali", ",", "Veli", "Ankara", "'", "da"], ["B-PER", "O", "B-PER", "B-LOC", "O", "O"])).toEqual(["Ali", "Veli"]);
  });
});

describe("windows", () => {
  it("is one window when the text fits", () => {
    expect(windows(100, 510, 128)).toEqual([{ start: 0, end: 100, ownStart: 0, ownEnd: 100 }]);
  });

  it("covers a long text with overlapping windows that own every token exactly once", () => {
    const list = windows(1200, 510, 128);
    expect(list[0]!.start).toBe(0);
    expect(list.at(-1)!.end).toBe(1200);
    const owner = new Array(1200).fill(0);
    for (const w of list) {
      expect(w.end - w.start).toBeLessThanOrEqual(510);
      for (let i = w.ownStart; i < w.ownEnd; i++) owner[i]++;
    }
    expect(owner.every((count) => count === 1)).toBe(true);
    // Every owned token has context on both sides, except at the text's own ends
    for (const w of list.slice(1)) expect(w.ownStart - w.start).toBe(64);
  });
});
