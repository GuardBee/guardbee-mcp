import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { maskPiiInValue } from "@guardbee/guard-core";
import { loadSamples } from "../data.js";
import { bootstrap, metrics } from "../metrics.js";
import { regressionScores, type RegressionScores } from "../regression.js";

/** How far a score may fall below the recorded one before CI fails. */
const TOLERANCE = 0.01;

describe("prompt-injection benchmark regression gate", () => {
  it("GuardBee's rules score no worse than the recorded baseline", async () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "results", "regression.json"), "utf8")) as RegressionScores;
    const current = await regressionScores();
    const drops: string[] = [];
    for (const [system, langs] of Object.entries(baseline)) {
      for (const [lang, was] of Object.entries(langs)) {
        const now = current[system]?.[lang];
        if (!now) {
          drops.push(`${system} / ${lang}: no longer scored`);
          continue;
        }
        for (const key of ["f1", "recall", "precision"] as const) {
          if (now[key] < was[key] - TOLERANCE) drops.push(`${system} / ${lang}: ${key} ${was[key]} → ${now[key]}`);
        }
      }
    }
    expect(drops, `Detector regressions (update results/regression.json with src/snapshot.ts only if intended):\n${drops.join("\n")}`).toEqual([]);
  });
});

describe("dataset", () => {
  const all = loadSamples();

  it("has at least 500 attacks and 500 benign samples per language, split in two halves", () => {
    for (const lang of ["en", "tr"] as const) {
      for (const label of ["attack", "benign"] as const) {
        const rows = all.filter((s) => s.lang === lang && s.label === label);
        expect(rows.length, `${lang} ${label}`).toBeGreaterThanOrEqual(500);
        const test = rows.filter((s) => s.split === "test").length;
        expect(Math.abs(test - rows.length / 2), `${lang} ${label} split`).toBeLessThan(rows.length * 0.1);
      }
    }
  });

  it("has unique ids and a documented source for every row", () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    const sources = new Set(all.map((s) => s.source));
    expect([...sources].sort()).toEqual(["Lakera/gandalf_ignore_instructions", "OpenAssistant/oasst2", "deepset/prompt-injections", "hand-written", "jackhhao/jailbreak-classification"]);
    for (const s of all.filter((x) => x.translation)) expect(s.translation!.model).toMatch(/^Helsinki-NLP\/opus-mt-tc-big-en-tr@/);
  });

  it("holds no credentials or personal identifiers that pass checksum validation", () => {
    const found = new Map<string, string[]>();
    for (const s of all) {
      maskPiiInValue(s.text, (name, match) => {
        if (["tc_kimlik", "iban", "credit_card", "secret"].includes(name)) found.set(s.id, [...(found.get(s.id) ?? []), `${name}:${match.slice(0, 6)}…`]);
        return match;
      });
    }
    expect([...found.entries()]).toEqual([]);
  });
});

describe("metrics", () => {
  it("computes precision, recall, F1 and reproducible bootstrap intervals", () => {
    const pairs = [
      { positive: true, predicted: true },
      { positive: true, predicted: false },
      { positive: false, predicted: false },
      { positive: false, predicted: true },
    ];
    expect(metrics(pairs)).toMatchObject({ precision: 0.5, recall: 0.5, f1: 0.5, fpr: 0.5 });
    expect(bootstrap(pairs, 200, 7)).toEqual(bootstrap(pairs, 200, 7));
  });
});
