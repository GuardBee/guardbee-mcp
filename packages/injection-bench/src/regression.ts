import { loadSamples } from "./data.js";
import { metrics } from "./metrics.js";
import { guardbeeBlock, guardbeeBlockOrWarn } from "./systems.js";

export type RegressionScores = Record<string, Record<string, { f1: number; recall: number; precision: number }>>;

/** The deterministic GuardBee systems over the whole dataset (both splits), per language: what CI compares against results/regression.json. */
export async function regressionScores(): Promise<RegressionScores> {
  const samples = loadSamples();
  const out: RegressionScores = {};
  for (const system of [guardbeeBlock(), guardbeeBlockOrWarn()]) {
    out[system.name] = {};
    for (const lang of ["en", "tr"] as const) {
      const pairs = [];
      for (const s of samples.filter((x) => x.lang === lang)) pairs.push({ positive: s.label === "attack", predicted: await system.detect(s.text, s.lang) });
      const m = metrics(pairs);
      out[system.name]![lang] = { f1: Number(m.f1.toFixed(4)), recall: Number(m.recall.toFixed(4)), precision: Number(m.precision.toFixed(4)) };
    }
  }
  return out;
}
