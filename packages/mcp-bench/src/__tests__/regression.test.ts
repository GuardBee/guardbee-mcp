import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../data.js";
import { bootstrap, metrics } from "../metrics.js";
import { regressionScores } from "../regression.js";

/** How far a score may fall below the recorded one before CI fails. */
const TOLERANCE = 0.02;

describe("MCP Security Benchmark regression gate", () => {
  it("GuardBee's detectors score no worse than the recorded baseline", async () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "results", "regression.json"), "utf8")) as Awaited<ReturnType<typeof regressionScores>>;
    const current = await regressionScores();
    const drops: string[] = [];
    for (const [system, tasks] of Object.entries(baseline)) {
      for (const [task, was] of Object.entries(tasks)) {
        const now = current[system]?.[task];
        if (!now) {
          drops.push(`${system} / ${task}: no longer scored`);
          continue;
        }
        for (const key of ["f1", "recall", "precision"] as const) {
          if (now[key] < was[key] - TOLERANCE) drops.push(`${system} / ${task}: ${key} ${was[key]} → ${now[key]}`);
        }
      }
    }
    expect(drops, `Detector regressions (update results/regression.json with src/snapshot.ts only if intended):\n${drops.join("\n")}`).toEqual([]);
  });
});

describe("dataset", () => {
  it("is balanced, split in two, and every row is well-formed", () => {
    const all = loadDataset();
    for (const [task, rows] of Object.entries(all) as [string, { id: string; split: string; label: string }[]][]) {
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.size, `${task} ids are unique`).toBe(rows.length);
      expect(new Set(rows.map((r) => r.split))).toEqual(new Set(["dev", "test"]));
      const labels = new Map<string, number>();
      for (const r of rows) labels.set(r.label, (labels.get(r.label) ?? 0) + 1);
      expect(labels.size, `${task} has two labels`).toBe(2);
      expect(Math.abs([...labels.values()][0]! - [...labels.values()][1]!), `${task} is balanced`).toBeLessThanOrEqual(2);
    }
  });

  it("holds no real-looking credentials", () => {
    const text = fs.readFileSync(path.join(__dirname, "..", "..", "data", "tools.jsonl"), "utf8") + fs.readFileSync(path.join(__dirname, "..", "..", "data", "results.jsonl"), "utf8");
    expect(text).not.toMatch(/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });
});

describe("metrics", () => {
  it("computes precision, recall, F1 and stable bootstrap intervals", () => {
    const pairs = [
      { positive: true, predicted: true },
      { positive: true, predicted: false },
      { positive: false, predicted: false },
      { positive: false, predicted: true },
    ];
    expect(metrics(pairs)).toMatchObject({ tp: 1, fn: 1, tn: 1, fp: 1, precision: 0.5, recall: 0.5, f1: 0.5, fpr: 0.5 });
    expect(bootstrap(pairs, 200, 7)).toEqual(bootstrap(pairs, 200, 7));
  });
});
