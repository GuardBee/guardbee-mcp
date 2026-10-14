import { describe, expect, it } from "vitest";
import { detectTopics, foldText, type TopicDefinition } from "../topics.js";

const MA: TopicDefinition = { id: "ma", terms: ["birleşme", "satın alma", "due diligence", "acquisition"] };
const SALARY: TopicDefinition = { id: "salary", terms: ["maaş", "bordro", "salary", "payroll"] };
const ids = (value: unknown, topics: TopicDefinition[] = [MA, SALARY]) => detectTopics(value, topics).map((hit) => hit.id);

describe("foldText", () => {
  it("folds Turkish case and letters", () => {
    expect(foldText("BİRLEŞME Işık ÇAĞRI Öğün")).toBe("birlesme isik cagri ogun");
    expect(foldText("İSTANBUL")).toBe(foldText("istanbul"));
  });
});

describe("detectTopics", () => {
  it("matches regardless of case and Turkish letters", () => {
    expect(ids("ACME ile BİRLEŞME görüşmesi")).toEqual(["ma"]);
    expect(ids("acme ile birlesme gorusmesi")).toEqual(["ma"]);
  });

  it("lets a term take a Turkish suffix, but only at the start of a word", () => {
    expect(ids("Ekip maaşlarını Excel'e aktar")).toEqual(["salary"]);
    expect(ids("Şirketi satın almayı düşünüyoruz")).toEqual(["ma"]);
    expect(ids("tamaaş")).toEqual([]);
  });

  it("matches phrases across extra spaces, line breaks and punctuation", () => {
    expect(ids("we are in due\n  diligence now")).toEqual(["ma"]);
    expect(ids("due-diligence checklist")).toEqual(["ma"]);
  });

  it("quoted terms match the whole word only", () => {
    const ai: TopicDefinition = { id: "ai", terms: ['"AI"'] };
    expect(ids("our AI roadmap", [ai])).toEqual(["ai"]);
    expect(ids("our AIM is high", [ai])).toEqual([]);
  });

  it("needs minMatches different terms", () => {
    const strict: TopicDefinition = { ...MA, minMatches: 2 };
    expect(ids("acquisition", [strict])).toEqual([]);
    expect(ids("acquisition after due diligence", [strict])).toEqual(["ma"]);
    expect(detectTopics("acquisition after due diligence", [strict])[0]!.terms).toEqual(["due diligence", "acquisition"]);
  });

  it("reads every string in nested arguments and results", () => {
    expect(ids({ to: "hr@acme.com", body: { lines: ["Ekim", "bordro ekte"] } })).toEqual(["salary"]);
    expect(ids([{ type: "text", text: "Q3 acquisition targets" }, null])).toEqual(["ma"]);
    expect(ids({ n: 3 })).toEqual([]);
  });
});
