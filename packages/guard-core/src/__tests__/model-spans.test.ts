import { describe, expect, it } from "vitest";
import { OrgPatterns } from "../org-patterns.js";
import { maskPiiInText, maskPiiInValue, type SpanLookup } from "../pii.js";
import { piiScope } from "../presets.js";

/** What an NER model would return, keyed by text; an unscanned text throws, as a real lookup must. */
function lookup(results: Record<string, [string, string][]>): SpanLookup {
  return (text) => {
    const found = results[text];
    if (!found) throw new Error("text was not scanned");
    return found.map(([value, detector]) => {
      const start = text.indexOf(value);
      return { start, end: start + value.length, detector };
    });
  };
}

const TEXT = "Ayşe Yılmaz aradı, TC 10000000146";
const spans = lookup({ [TEXT]: [["Ayşe Yılmaz", "person_name"]] });

describe("model spans", () => {
  it("masks what the model found next to the regex detections", () => {
    expect(maskPiiInText(TEXT, undefined, undefined, undefined, spans)).toBe("[KİŞİ] aradı, TC [TC-KİMLİK]");
  });

  it("hands each value to the replacer under its detector name", () => {
    const seen: [string, string][] = [];
    maskPiiInText(TEXT, (name, match) => (seen.push([name, match]), match), undefined, undefined, spans);
    expect(seen).toEqual([
      ["person_name", "Ayşe Yılmaz"],
      ["tc_kimlik", "10000000146"],
    ]);
  });

  it("follows the scope: a selection without person_name leaves names", () => {
    expect(maskPiiInText(TEXT, undefined, piiScope({ preset: "IDENTIFIERS" }), undefined, spans)).toBe("Ayşe Yılmaz aradı, TC [TC-KİMLİK]");
    expect(maskPiiInText(TEXT, undefined, piiScope({ preset: "KVKK", disable: ["person_name"] }), undefined, spans)).toContain("Ayşe Yılmaz");
    expect(maskPiiInText(TEXT, undefined, piiScope({ preset: "IDENTITY" }), undefined, spans)).toBe("[KİŞİ] aradı, TC 10000000146");
  });

  it("looks every string of a value up, and fails when one was not scanned", () => {
    const value = { from: "Mehmet Kaya", note: "Mehmet Kaya ile görüşüldü" };
    const all = lookup({ "Mehmet Kaya": [["Mehmet Kaya", "person_name"]], "Mehmet Kaya ile görüşüldü": [["Mehmet Kaya", "person_name"]] });
    expect(maskPiiInValue(value, undefined, undefined, undefined, all)).toEqual({ from: "[KİŞİ]", note: "[KİŞİ] ile görüşüldü" });
    expect(() => maskPiiInValue({ ...value, extra: "yeni" }, undefined, undefined, undefined, all)).toThrow(/not scanned/);
  });

  it("skips spans that overlap or fall outside the text", () => {
    const odd: SpanLookup = () => [
      { start: 0, end: 4, detector: "person_name" },
      { start: 2, end: 11, detector: "person_name" },
      { start: 30, end: 99, detector: "person_name" },
    ];
    expect(maskPiiInText("Ayşe Yılmaz aradı", undefined, undefined, undefined, odd)).toBe("[KİŞİ] Yılmaz aradı");
  });

  it("leaves a name inside an e-mail address or URL to the regex, which masks it whole", () => {
    const text = "yazın: ayse.yilmaz@example.com veya https://example.com/ayse";
    const found = lookup({ [text]: [["ayse", "person_name"]] });
    const odd: SpanLookup = (t) => [...found(t), { start: text.lastIndexOf("ayse"), end: text.length, detector: "person_name" }];
    expect(maskPiiInText(text, undefined, undefined, undefined, odd)).toBe("yazın: ***@[EMAIL] veya https://example.com/ayse");
  });

  it("works with org patterns: an allow pattern can keep a name, a block pattern still runs", () => {
    const org = OrgPatterns.compile({ allowPatterns: ["^Ayşe Yılmaz$"], blockPatterns: [{ pattern: "MUS-\\d{4}", category: "CLIENT_NO" }] });
    const text = "Ayşe Yılmaz, müşteri MUS-1234";
    const found = lookup({ [text]: [["Ayşe Yılmaz", "person_name"]] });
    expect(maskPiiInText(text, undefined, undefined, org, found)).toBe("Ayşe Yılmaz, müşteri <CLIENT_NO_1>");
  });
});
