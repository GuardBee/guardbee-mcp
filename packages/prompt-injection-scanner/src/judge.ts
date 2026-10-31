import { readFileSync } from "fs";
import type { Judge } from "@guardbee/guard-core";
import type { Finding } from "./scanner.js";

/**
 * Semantic injection with an LLM judge (opt-in, --judge): each file is read
 * in chunks by the model, which catches instructions the patterns do not
 * know — paraphrased, translated, split across sentences. The judge only
 * adds findings; the pattern findings stay as they are.
 */

export interface JudgeScanOptions {
  /** Report at this confidence or above; default 0.7. */
  minConfidence?: number;
  /** At most this many model calls in total; default 200. */
  maxCalls?: number;
  /** Characters per chunk; default 6000. */
  chunkSize?: number;
  onError?: (file: string, error: Error) => void;
}

/** Chunks on line boundaries, with their first line number. */
function chunks(text: string, size: number): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const lines = text.split("\n");
  let current: string[] = [];
  let length = 0;
  let start = 1;
  lines.forEach((line, i) => {
    if (length + line.length > size && current.length) {
      out.push({ text: current.join("\n"), line: start });
      current = [];
      length = 0;
      start = i + 1;
    }
    current.push(line.slice(0, size));
    length += line.length + 1;
  });
  if (current.join("").trim()) out.push({ text: current.join("\n"), line: start });
  return out;
}

export async function judgeText(text: string, filePath: string | undefined, judge: Judge, options: JudgeScanOptions & { budget?: { left: number } } = {}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const chunk of chunks(text, options.chunkSize ?? 6000)) {
    if (options.budget && options.budget.left-- <= 0) break;
    if (!chunk.text.trim()) continue;
    let verdict;
    try {
      verdict = await judge.classifyInjection(chunk.text, { where: filePath ? `file ${filePath.split("/").pop()}` : "document" });
    } catch (err) {
      options.onError?.(filePath ?? "text", err instanceof Error ? err : new Error(String(err)));
      continue;
    }
    if (verdict.verdict !== "malicious" || verdict.confidence < (options.minConfidence ?? 0.7)) continue;
    findings.push({
      patternId: "judge_semantic_injection",
      patternName: "Instructions to the agent hidden in content (LLM judge)",
      category: "instruction-override",
      severity: "high",
      recommendation: `${verdict.reason ? `${verdict.reason} ` : ""}Content an agent reads should not instruct it. Remove the text, or keep this content away from agents that can act on it.`,
      ...(filePath ? { file: filePath } : {}),
      line: chunk.line,
      column: 1,
      match: chunk.text.trim().replace(/\s+/g, " ").slice(0, 160),
      context: "",
      judge: { model: verdict.model.name, ...(verdict.model.version ? { version: verdict.model.version } : {}), confidence: verdict.confidence },
    });
  }
  return findings;
}

export async function judgeFiles(paths: string[], judge: Judge, options: JudgeScanOptions = {}): Promise<Finding[]> {
  const budget = { left: options.maxCalls ?? 200 };
  const findings: Finding[] = [];
  for (const path of paths) {
    if (budget.left <= 0) break;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    findings.push(...(await judgeText(text, path, judge, { ...options, budget })));
  }
  return findings;
}
