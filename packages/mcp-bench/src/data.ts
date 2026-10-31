import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Split = "dev" | "test";

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

interface Base {
  id: string;
  split: Split;
  lang: "en" | "tr";
  technique: string;
}
export interface ToolCase extends Base { label: "poisoned" | "benign"; tool: ToolDef }
export interface ResultCase extends Base { label: "injection" | "benign"; text: string }
export interface FlowCase extends Base { label: "toxic" | "safe"; tools: ToolDef[] }
export interface RugPullCase extends Base { label: "rugpull" | "benign"; before: ToolDef; after: ToolDef }

export interface Dataset {
  tools: ToolCase[];
  results: ResultCase[];
  flows: FlowCase[];
  rugpulls: RugPullCase[];
}

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

const read = <T>(file: string): T[] =>
  fs
    .readFileSync(path.join(DATA_DIR, file), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);

export function loadDataset(split?: Split): Dataset {
  const pick = <T extends Base>(rows: T[]) => (split ? rows.filter((r) => r.split === split) : rows);
  return {
    tools: pick(read<ToolCase>("tools.jsonl")),
    results: pick(read<ResultCase>("results.jsonl")),
    flows: pick(read<FlowCase>("flows.jsonl")),
    rugpulls: pick(read<RugPullCase>("rugpulls.jsonl")),
  };
}

export const POSITIVE: Record<keyof Dataset, string> = { tools: "poisoned", results: "injection", flows: "toxic", rugpulls: "rugpull" };

/** Every string a model reads in a tool definition: description, title, schema descriptions and enum values. */
export function toolText(tool: ToolDef): string {
  const out: string[] = [tool.name, tool.description ?? ""];
  if (typeof tool.annotations?.["title"] === "string") out.push(tool.annotations["title"] as string);
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec["description"] === "string") out.push(rec["description"]);
    if (Array.isArray(rec["enum"])) out.push(...rec["enum"].filter((v): v is string => typeof v === "string"));
    for (const value of Object.values(rec)) if (value && typeof value === "object") walk(value);
  };
  walk(tool.inputSchema);
  return out.filter(Boolean).join("\n");
}
