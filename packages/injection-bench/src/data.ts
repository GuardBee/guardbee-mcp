import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Lang = "en" | "tr";
export type Split = "dev" | "test";

export interface Sample {
  id: string;
  lang: Lang;
  split: Split;
  label: "attack" | "benign";
  /** Attack family or kind of benign text (direct_override, jailbreak, roleplay_benign, …). */
  technique: string;
  /** Where the text comes from: a public dataset id, or "hand-written". */
  source: string;
  text: string;
  /** Set when the text is a machine translation: the model, and the id of the English original in the source set. */
  translation?: { from: "en"; model: string };
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

export function loadSamples(filter: { split?: Split; lang?: Lang } = {}): Sample[] {
  const rows: Sample[] = [];
  for (const lang of ["en", "tr"] as const) {
    if (filter.lang && filter.lang !== lang) continue;
    for (const line of fs.readFileSync(path.join(dir, `${lang}.jsonl`), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Sample;
      if (!filter.split || row.split === filter.split) rows.push(row);
    }
  }
  return rows;
}
