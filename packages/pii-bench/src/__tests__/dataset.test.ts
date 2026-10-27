import { readFileSync } from "node:fs";
import { isValidIban, isValidLuhn, isValidTcKimlik, isValidTrPhone, isValidVkn } from "@guardbee/guard-core";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../categories.js";
import { CHALLENGE_PATH, DATASET_PATH, SPECIAL_CHALLENGE_PATH, generateChallenge, generateDataset, generateSpecialChallenge, render, toJsonl } from "../generate.js";
import { notTcKimlik, rng, suffix } from "../identities.js";
import { loadDataset } from "../run.js";

const docs = loadDataset();

describe("dataset", () => {
  it("is what the generator writes", () => {
    expect(readFileSync(DATASET_PATH, "utf8")).toBe(toJsonl(generateDataset()));
    expect(readFileSync(CHALLENGE_PATH, "utf8")).toBe(toJsonl(generateChallenge()));
    expect(readFileSync(SPECIAL_CHALLENGE_PATH, "utf8")).toBe(toJsonl(generateSpecialChallenge()));
  });

  it("labels every special category in the Art. 6 challenge, with clean lines that use the same words", () => {
    const special = loadDataset(SPECIAL_CHALLENGE_PATH);
    const categories = new Set(special.flatMap((doc) => doc.spans.map((span) => span.category)));
    for (const category of ["health", "religion_belief", "ethnic_origin", "political_opinion", "union_membership", "criminal_record", "sex_life", "biometric", "genetic"]) {
      expect(categories.has(category as never), category).toBe(true);
    }
    expect(special.filter((doc) => doc.set === "clean").length).toBeGreaterThanOrEqual(15);
  });

  it("splits the name challenge into lines with a name and lines without", () => {
    const challenge = loadDataset(CHALLENGE_PATH);
    expect(challenge.filter((doc) => doc.set === "pii").length).toBeGreaterThanOrEqual(25);
    expect(challenge.filter((doc) => doc.set === "clean").length).toBeGreaterThanOrEqual(15);
    for (const doc of challenge) for (const span of doc.spans) expect(span.category).toBe("person_name");
  });

  it("has unique ids, labels only in the PII set, and no overlapping spans", () => {
    expect(new Set(docs.map((doc) => doc.id)).size).toBe(docs.length);
    for (const doc of docs) {
      if (doc.set === "clean") expect(doc.spans, doc.id).toEqual([]);
      else expect(doc.spans.length, doc.id).toBeGreaterThan(0);
      const sorted = [...doc.spans].sort((a, b) => a.start - b.start);
      for (const [i, span] of sorted.entries()) {
        expect(span.end, doc.id).toBeLessThanOrEqual(doc.text.length);
        expect(doc.text.slice(span.start, span.end).trim(), doc.id).toBe(doc.text.slice(span.start, span.end));
        if (i > 0) expect(span.start, doc.id).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
      }
    }
  });

  it("labels every category at least 15 times", () => {
    const support = new Map<string, number>();
    for (const doc of docs) for (const span of doc.spans) support.set(span.category, (support.get(span.category) ?? 0) + 1);
    for (const category of CATEGORIES) expect(support.get(category) ?? 0, category).toBeGreaterThanOrEqual(15);
  });

  it("uses identities that pass their checksums", () => {
    const checks: Record<string, (value: string) => boolean> = {
      tc_kimlik: isValidTcKimlik,
      vkn: isValidVkn,
      iban: isValidIban,
      credit_card: isValidLuhn,
      phone_tr: isValidTrPhone,
    };
    for (const doc of docs) {
      for (const span of doc.spans) {
        const check = checks[span.category];
        if (check) expect(check(doc.text.slice(span.start, span.end)), `${doc.id} ${span.category}`).toBe(true);
      }
    }
  });

  it("writes order numbers that fail the TC Kimlik checksum", () => {
    const rand = rng(1);
    for (let i = 0; i < 200; i++) expect(isValidTcKimlik(notTcKimlik(rand))).toBe(false);
  });
});

describe("render", () => {
  it("labels a name without its case suffix or title", () => {
    const { text, spans } = render("{P:gen} dosyası, {P.hitap:dat} iletildi", rng(3));
    const [name, first] = spans.map((span) => text.slice(span.start, span.end));
    expect(spans.map((span) => span.category)).toEqual(["person_name", "person_name"]);
    expect(text.startsWith(`${name}'`)).toBe(true);
    expect(text).toMatch(new RegExp(`, ${first} (Hanım|Bey)'(y?a|y?e) iletildi$`));
  });

  it("labels fixed text marked with [[text|category]]", () => {
    const { text, spans } = render("eşinin [[evlilik dışı ilişkisi|sex_life]] var", rng(3));
    expect(spans).toEqual([{ start: 7, end: 28, category: "sex_life" }]);
    expect(text.slice(7, 28)).toBe("evlilik dışı ilişkisi");
  });

  it("rejects an unknown slot", () => {
    expect(() => render("{nope}", rng(1))).toThrow(/unknown slot/);
  });
});

describe("suffix", () => {
  it.each([
    ["Ayşe", "gen", "'nin"],
    ["Yılmaz", "gen", "'ın"],
    ["Öztürk", "gen", "'ün"],
    ["Ahmet", "dat", "'e"],
    ["Kaya", "acc", "'yı"],
    ["Hanım", "dat", "'a"],
    ["Bey", "dat", "'e"],
    ["Öztürk", "abl", "'ten"],
    ["Doğan", "loc", "'da"],
  ] as const)("%s + %s = %s", (word, kind, expected) => {
    expect(suffix(word, kind)).toBe(expected);
  });
});
