import { loadDataset, POSITIVE, type Dataset } from "./data.js";
import { metrics } from "./metrics.js";
import { guardbeeRugPullContent, guardbeeRules, type System } from "./systems.js";
import { TASKS } from "./evaluate.js";

/**
 * The deterministic GuardBee systems over the whole dataset (both splits):
 * what CI compares against results/regression.json. No network, no model.
 */
export async function regressionScores(): Promise<Record<string, Record<string, { f1: number; recall: number; precision: number }>>> {
  const data = loadDataset();
  const out: Record<string, Record<string, { f1: number; recall: number; precision: number }>> = {};
  for (const system of [guardbeeRules(), guardbeeRugPullContent()] as System[]) {
    const tasks: Record<string, { f1: number; recall: number; precision: number }> = {};
    for (const task of TASKS) {
      const fn = { tools: system.tools, results: system.results, flows: system.flows, rugpulls: system.rugpulls }[task];
      if (!fn) continue;
      const pairs = [];
      for (const row of data[task as keyof Dataset] as unknown as Record<string, unknown>[]) {
        const predicted =
          task === "tools" ? await system.tools!(row["tool"] as never) : task === "results" ? await system.results!(row["text"] as string) : task === "flows" ? await system.flows!(row["tools"] as never) : await system.rugpulls!(row["before"] as never, row["after"] as never);
        pairs.push({ positive: row["label"] === POSITIVE[task], predicted });
      }
      const m = metrics(pairs);
      tasks[task] = { f1: Number(m.f1.toFixed(4)), recall: Number(m.recall.toFixed(4)), precision: Number(m.precision.toFixed(4)) };
    }
    out[system.name] = tasks;
  }
  return out;
}
