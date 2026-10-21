import { describe, expect, it } from "vitest";
import { maskPiiInText } from "../pii.js";

const TC = "10000000146";
const b64 = (s: string) => Buffer.from(s).toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64").toString("utf8");
const mask = (text: string) => maskPiiInText(text);

describe("base64 and hex runs", () => {
  it("masks the decoded text and encodes it again as it was written", () => {
    const value = mask(`token=${b64(TC)}`);
    expect(value).toMatch(/^token=[A-Za-z0-9+/]+=*$/);
    expect(unb64(value.slice(6))).toBe("[TC-KİMLİK]");

    const sentence = mask(`payload ${b64(`TC: ${TC}, mail ahmet@example.com`)}`).slice(8);
    expect(unb64(sentence)).toBe("TC: [TC-KİMLİK], mail ***@[EMAIL]");

    const unpadded = mask(`v=${b64(TC).replace(/=+$/, "")}`).slice(2);
    expect(unpadded).not.toContain("=");
    expect(unb64(unpadded)).toBe("[TC-KİMLİK]");
  });

  it("reads base64url and hex", () => {
    const state = Buffer.from(JSON.stringify({ tc: TC })).toString("base64url");
    const masked = mask(`/callback?state=${state}`).split("=")[1]!;
    expect(masked).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(masked, "base64url").toString("utf8")).toBe('{"tc":"[TC-KİMLİK]"}');

    const hex = mask(`data=${Buffer.from(`tc=${TC}`).toString("hex")}`).slice(5);
    expect(Buffer.from(hex, "hex").toString("utf8")).toBe("tc=[TC-KİMLİK]");
  });

  it("goes two encodings deep, no deeper", () => {
    expect(unb64(unb64(mask(`blob=${b64(b64(TC))}`).slice(5)))).toBe("[TC-KİMLİK]");
    const threeDeep = `blob=${b64(b64(b64(TC)))}`;
    expect(mask(threeDeep)).toBe(threeDeep);
  });

  it("leaves hashes, binary blobs, ids and encoded text with nothing personal", () => {
    for (const text of [
      "sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      `note=${b64("Toplantı yarın saat 10'da.")}`,
      "src/components/UserProfileSettingsPanel.tsx",
      "Muvaffakiyetsizleştiricileştiriveremeyebileceklerimizdenmişsinizcesine",
    ]) {
      expect(mask(text)).toBe(text);
    }
  });

  it("hands the replacer the decoded value, so a vault gives it the same token as the plain one", () => {
    const seen: string[] = [];
    maskPiiInText(`a ${TC} b ${b64(TC)}`, (name, match) => (seen.push(`${name}:${match}`), undefined));
    expect(seen).toEqual([`tc_kimlik:${TC}`, `tc_kimlik:${TC}`]);
  });

  it("does not ask the model's span lookup about decoded text it never saw", () => {
    const text = `Ayşe ${b64(TC)}`;
    const spans = (scanned: string) => {
      if (scanned !== text) throw new Error(`unscanned: ${scanned}`);
      return [{ start: 0, end: 4, detector: "person_name" }];
    };
    expect(maskPiiInText(text, undefined, undefined, undefined, spans)).toMatch(/^\[KİŞİ\] [A-Za-z0-9+/]+=*$/);
  });
});

describe("character escapes", () => {
  it.each([
    ["HTML decimal entities", `TC &#49;&#48;&#48;&#48;&#48;&#48;&#48;&#48;&#49;&#52;&#54; bitti`, "TC [TC-KİMLİK] bitti"],
    ["HTML hex entities and named @", "mail ahmet&#x2e;yilmaz&commat;example.com", "mail ***@[EMAIL]"],
    ["JSON \\u escapes", '{"tc":"\\u0031\\u0030\\u0030\\u0030\\u0030\\u0030\\u0030\\u0030\\u0031\\u0034\\u0036","n":1}', '{"tc":"[TC-KİMLİK]","n":1}'],
    ["URL escapes", "?email=ahmet%2Eyilmaz%40example.com&page=2", "?email=***@[EMAIL]&page=2"],
    ["URL escapes, every character", `q=${[...TC].map((c) => `%${c.charCodeAt(0).toString(16)}`).join("")}`, "q=[TC-KİMLİK]"],
  ])("%s", (_name, text, masked) => {
    expect(mask(text)).toBe(masked);
  });

  it("keeps escapes of ordinary text, and percentages, as written", () => {
    for (const text of ["Kampanyada %50 indirim, %20 ek.", "https://example.com/ara?q=%C3%A7ilek%20re%C3%A7eli", "Fiyat &lt; 100 TL &amp; kargo &#252;cretsiz", '{"t":"\\u00c7al\\u0131\\u015fma"}']) {
      expect(mask(text)).toBe(text);
    }
  });
});

describe("other scripts' digits", () => {
  it.each([
    ["Arabic-Indic", "TC: ١٠٠٠٠٠٠٠١٤٦", "TC: [TC-KİMLİK]"],
    ["Extended Arabic-Indic", "TC: ۱۰۰۰۰۰۰۰۱۴۶", "TC: [TC-KİMLİK]"],
    ["Devanagari", "tel ०५३२१२३४५६७", "tel +90-***-***-**[TELEFON]"],
  ])("%s", (_name, text, masked) => {
    expect(mask(text)).toBe(masked);
  });

  it("leaves numbers that are not identifiers", () => {
    expect(mask("السعر ١٢٥ ريال")).toBe("السعر ١٢٥ ريال");
  });
});

describe("separators and spelled-out forms", () => {
  it.each([
    ["TC: 100 000 001 46", "TC: [TC-KİMLİK]"],
    ["T.C. Kimlik No: 100-000-001-46", "T.C. Kimlik No: [TC-KİMLİK]"],
    ["TCKN 1 0 0 0 0 0 0 0 1 4 6", "TCKN [TC-KİMLİK]"],
    ["+90.532.123.45.67", "+90-***-***-**[TELEFON]"],
    ["0532.123.45.67 arayın", "+90-***-***-**[TELEFON] arayın"],
    ["ahmet.yilmaz [at] example [dot] com", "***@[EMAIL]"],
    ["ahmet(at)example.com", "***@[EMAIL]"],
    ["ahmet at example dot com", "***@[EMAIL]"],
    ["ayse {at} firma [nokta] com [nokta] tr", "***@[EMAIL]"],
  ])("finds %s", (text, masked) => {
    expect(mask(text)).toBe(masked);
  });

  it.each(["TC: 100 000 001 47", "Sipariş 100 000 001 46 kargoda", "Versiyon 1.532.123.45.67", "look at the cat. Then go home.", "meet at noon dot"])("leaves %s", (text) => {
    expect(mask(text)).toBe(text);
  });
});
