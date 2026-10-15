import { describe, it, expect } from "vitest";
import { maskPiiInText } from "../pii.js";
import { NormalizedText, needsNormalization } from "../normalize.js";

/** Fullwidth digits/letters: U+FF10–U+FF19, U+FF21–U+FF3A, U+FF41–U+FF5A. */
const fullwidth = (s: string) =>
  s.replace(/[0-9A-Za-z@.]/g, (c) => (c === "@" ? "＠" : c === "." ? "．" : String.fromCodePoint(c.codePointAt(0)! + 0xfee0)));
/** Mathematical bold small letters: U+1D41A–U+1D433. */
const bold = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97));
const ZWSP = "​";
const ZWJ = "‍";
const SOFT_HYPHEN = "­";

describe("Unicode look-alikes before detection", () => {
  it("masks a TC kimlik written in fullwidth digits", () => {
    expect(maskPiiInText(`TC: ${fullwidth("10000000146")}`)).toBe("TC: [TC-KİMLİK]");
  });

  it("masks an e-mail written in mathematical bold letters", () => {
    expect(maskPiiInText(`İletişim: ${bold("ahmet")}@example.com`)).toBe("İletişim: ***@[EMAIL]");
  });

  it("masks a fullwidth e-mail including its fullwidth @ and dots", () => {
    expect(maskPiiInText(`mail ${fullwidth("ahmet@example.com")} ok`)).toBe("mail ***@[EMAIL] ok");
  });

  it("masks an IBAN split with zero-width spaces", () => {
    const iban = "TR330006100519786457841326".split("").join(ZWSP);
    expect(maskPiiInText(`IBAN: ${iban}`)).toBe("IBAN: TR**[IBAN]");
  });

  it("masks an API key with a zero-width joiner and a soft hyphen inside", () => {
    const key = `ghp_${"aB3dE5fG7hJ9kL1m"}${ZWJ}${"N3pQ5rS7tU9vW1xY2zAb"}${SOFT_HYPHEN}`;
    const out = maskPiiInText(`token=${key} done`);
    expect(out).toBe("token=[API-KEY] done");
  });

  it("masks a card number mixing fullwidth and ASCII digits", () => {
    expect(maskPiiInText(`Kart: 4111 ${fullwidth("1111")} 1111 1111`)).toBe("Kart: ****-****-****-[KART]");
  });

  it("leaves a fullwidth number that fails the checksum alone, in its original spelling", () => {
    const text = `Sipariş: ${fullwidth("12345678901")}`;
    expect(maskPiiInText(text)).toBe(text);
  });

  it("keeps everything around a masked value in its original spelling", () => {
    const text = `${fullwidth("ABC")} ${ZWSP}önce ${fullwidth("10000000146")} sonra 😀${ZWJ}👍 ${bold("son")}`;
    expect(maskPiiInText(text)).toBe(`${fullwidth("ABC")} ${ZWSP}önce [TC-KİMLİK] sonra 😀${ZWJ}👍 ${bold("son")}`);
  });

  it("gives every spelling of a value the same normalized match", () => {
    const seen: string[] = [];
    maskPiiInText(`10000000146 ${fullwidth("10000000146")} 1000${ZWSP}0000146`, (name, match) => {
      seen.push(`${name}:${match}`);
      return "[X]";
    });
    expect(seen).toEqual(["tc_kimlik:10000000146", "tc_kimlik:10000000146", "tc_kimlik:10000000146"]);
  });

  it("returns the original text when a replacer hands the match back unchanged", () => {
    const text = `TC ${fullwidth("10000000146")}${ZWSP} ve ${bold("ali")}@example.com`;
    expect(maskPiiInText(text, (_name, match) => match)).toBe(text);
  });

  it("drops the whole original span when the replacer returns an empty string", () => {
    expect(maskPiiInText(`a ${fullwidth("10000000146")} b`, () => "")).toBe("a  b");
  });

  it("composes a combining dot so a decomposed İ still reads as one letter", () => {
    const text = `İstanbul ${fullwidth("10000000146")}`;
    expect(maskPiiInText(text)).toBe("İstanbul [TC-KİMLİK]");
  });
});

describe("NormalizedText", () => {
  it("strips invisible characters and applies NFKC in the detection copy", () => {
    expect(new NormalizedText(`${ZWSP}a${ZWSP}${fullwidth("1")}ﬁ`).text).toBe("a1fi");
  });

  it("returns the original untouched when nothing is replaced, even if it is only invisible", () => {
    const working = new NormalizedText(`${ZWSP}${ZWJ}`);
    working.replace(/x/g, () => "y");
    expect(working.toString()).toBe(`${ZWSP}${ZWJ}`);
  });

  it("only takes the slow path for text that changes", () => {
    expect(needsNormalization("plain ascii 10000000146")).toBe(false);
    expect(needsNormalization("Türkçe metin İğüşöç")).toBe(false);
    expect(needsNormalization(fullwidth("1"))).toBe(true);
    expect(needsNormalization(`a${ZWSP}b`)).toBe(true);
  });
});
