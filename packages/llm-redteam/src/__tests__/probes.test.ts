import { describe, it, expect } from "vitest";
import { PROBES } from "../probes.js";

describe("PROBES — structural integrity", () => {
  it("every probe has a unique id", () => {
    const ids = PROBES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every probe without a custom buildPrompt has {{CANARY}} in its template", () => {
    for (const p of PROBES) {
      if (p.buildPrompt) continue;
      expect(p.template).toContain("{{CANARY}}");
    }
  });

  it("every probe has a non-empty recommendation", () => {
    for (const p of PROBES) {
      expect(p.recommendation.length).toBeGreaterThan(20);
    }
  });

  it("no probe template asks for genuinely harmful content — only canary reproduction", () => {
    const harmfulKeywords = ["bomb", "weapon", "malware", "poison", "hack into", "self-harm"];
    for (const p of PROBES) {
      const text = (p.template + (p.buildPrompt ? p.buildPrompt("TESTCANARY") : "")).toLowerCase();
      for (const kw of harmfulKeywords) {
        expect(text).not.toContain(kw);
      }
    }
  });

  it("covers at least 5 categories", () => {
    const categories = new Set(PROBES.map((p) => p.category));
    expect(categories.size).toBeGreaterThanOrEqual(5);
  });
});
