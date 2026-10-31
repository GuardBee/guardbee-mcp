import { loadDataset, POSITIVE, type Dataset, type Split } from "./data.js";
import { bootstrap, metrics, type Interval, type Metrics } from "./metrics.js";
import type { System } from "./systems.js";

export const TASKS: (keyof Dataset)[] = ["tools", "results", "flows", "rugpulls"];

export interface TaskScore {
  task: keyof Dataset;
  n: number;
  metrics: Metrics;
  intervals: Record<"precision" | "recall" | "f1" | "fpr", Interval>;
  /** Mean milliseconds per item (batch systems: the whole run divided by the items). */
  latencyMs: number;
  /** Ids the system got wrong, for error analysis. */
  misses: string[];
  falseAlarms: string[];
}

export interface SystemScore {
  system: string;
  version: string;
  settings: string;
  split: Split;
  tasks: TaskScore[];
}

type Case = { id: string; label: string };

export async function evaluate(system: System, split: Split): Promise<SystemScore> {
  const data = loadDataset(split);
  const tasks: TaskScore[] = [];
  for (const task of TASKS) {
    const cases = data[task] as unknown as Case[];
    if (!cases.length) continue;
    let predicted: Map<string, boolean> | undefined;
    const started = performance.now();
    if (system.batch) {
      const out = system.batch(task, data);
      if (out.size) predicted = out;
    } else {
      const fn =
        task === "tools" ? system.tools : task === "results" ? system.results : task === "flows" ? system.flows : system.rugpulls;
      if (fn) {
        predicted = new Map();
        for (const c of data[task]) {
          const row = c as never as Record<string, unknown>;
          const answer =
            task === "tools"
              ? await system.tools!(row["tool"] as never)
              : task === "results"
                ? await system.results!(row["text"] as string)
                : task === "flows"
                  ? await system.flows!(row["tools"] as never)
                  : await system.rugpulls!(row["before"] as never, row["after"] as never);
          predicted.set(row["id"] as string, answer);
        }
      }
    }
    if (!predicted) continue;
    const latencyMs = (performance.now() - started) / cases.length;
    const pairs = cases.map((c) => ({ id: c.id, positive: c.label === POSITIVE[task], predicted: predicted!.get(c.id) ?? false }));
    tasks.push({
      task,
      n: cases.length,
      metrics: metrics(pairs),
      intervals: bootstrap(pairs),
      latencyMs,
      misses: pairs.filter((p) => p.positive && !p.predicted).map((p) => p.id),
      falseAlarms: pairs.filter((p) => !p.positive && p.predicted).map((p) => p.id),
    });
  }
  return { system: system.name, version: system.version, settings: system.settings, split, tasks };
}
