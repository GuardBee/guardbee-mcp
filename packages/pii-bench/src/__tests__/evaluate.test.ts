import { describe, expect, it } from "vitest";
import type { Doc } from "../categories.js";
import { bootstrap, countDoc, metrics } from "../evaluate.js";
import { evaluate, loadDataset, toMarkdown } from "../run.js";
import { guardCoreSpans, SYSTEMS } from "../systems.js";

const doc = (text: string, spans: Doc["spans"], set: Doc["set"] = "pii"): Doc => ({ id: "t", domain: "chat", set, text, spans });

describe("guardCoreSpans", () => {
  it("maps each masked value back to its place in the text", () => {
    const text = "TCKN: 10000000146, e-posta ayse@example.com, tel 0532 123 45 67";
    const found = guardCoreSpans(text).map((d) => [d.category, text.slice(d.start, d.end)]);
    expect(found).toEqual([
      ["tc_kimlik", "10000000146"],
      ["email", "ayse@example.com"],
      ["phone_tr", "0532 123 45 67"],
    ]);
  });

  it("keeps a value a later detector swallowed as its own span", () => {
    // The address pattern takes the rest of the line, and runs before the TC Kimlik one
    const text = "Adres: Gazi Mah. Lale Sok. No:5 10000000146";
    const found = guardCoreSpans(text).map((d) => [d.category, text.slice(d.start, d.end)]);
    expect(found).toContainEqual(["address", "Gazi Mah. Lale Sok. No:5 10000000146"]);
  });

  it("finds nothing in plain text", () => {
    expect(guardCoreSpans("toplantı yarın 14:30'da")).toEqual([]);
  });
});

describe("metrics", () => {
  const text = "Ali Kaya TR330006100519786457841326 aradı";
  const gold = doc(text, [
    { start: 0, end: 8, category: "person_name" },
    { start: 9, end: 35, category: "iban" },
  ]);

  it("matches a detection to a label by overlap and category", () => {
    const m = metrics([countDoc(gold, [{ start: 9, end: 20, category: "iban" }])]);
    expect(m.perCategory.iban).toMatchObject({ support: 1, precision: 1, recall: 1, f1: 1, coverage: 0 });
    expect(m.perCategory.person_name).toMatchObject({ support: 1, precision: null, recall: 0, coverage: 0 });
    expect(m.micro).toMatchObject({ precision: 1, recall: 0.5 });
  });

  it("counts a label as masked only when it is covered end to end, whatever the category", () => {
    const m = metrics([
      countDoc(gold, [
        { start: 0, end: 3, category: "person_name" },
        { start: 3, end: 8, category: "email" },
        { start: 9, end: 35, category: "iban" },
      ]),
    ]);
    expect(m.perCategory.person_name.coverage).toBe(1);
    expect(m.perCategory.email).toMatchObject({ support: 0, precision: 0 });
  });

  it("counts a detection outside the label set against precision, and a flagged clean document as a false alarm", () => {
    const m = metrics([
      countDoc(gold, [{ start: 9, end: 35, category: "iban" }]),
      countDoc(doc("sk-live", [], "clean"), [{ start: 0, end: 7, category: "api_key" }]),
      countDoc(doc("merhaba", [], "clean"), []),
    ]);
    expect(m.otherDetections).toBe(1);
    expect(m.micro.precision).toBe(0.5);
    expect(m.falseAlarmRate).toBe(0.5);
  });

  it("bootstraps the same intervals from the same seed, around the point estimate", () => {
    const counts = Array.from({ length: 30 }, (_, i) => countDoc(gold, i % 3 === 0 ? [] : [{ start: 9, end: 35, category: "iban" }]));
    const first = bootstrap(counts, 200, 1);
    expect(bootstrap(counts, 200, 1)).toEqual(first);
    const [low, high] = first.get("perCategory.iban.recall")!;
    expect(low).toBeLessThan(2 / 3);
    expect(high).toBeGreaterThan(2 / 3);
  });
});

describe("evaluate", () => {
  it("runs guard-core over the dataset and reports what regex cannot see", async () => {
    const report = await evaluate(SYSTEMS["guard-core-regex"]!(), loadDataset(), 50);
    const { perCategory } = report.metrics;
    expect(perCategory.tc_kimlik.recall).toBe(1);
    expect(perCategory.iban.recall).toBe(1);
    expect(perCategory.person_name.recall).toBe(0);
    expect(perCategory.health.recall).toBe(0);
    expect(report.metrics.falseAlarmRate).toBeGreaterThan(0);
    expect(toMarkdown(report)).toContain("| tc_kimlik | 60 |");
  });
});
