import { readFileSync } from "fs";
import type { InjectionClassifier } from "@guardbee/guard-core";
import type { Finding } from "./scanner.js";

/**
 * The local injection classifier (opt-in, --classifier; @guardbee/injection-model):
 * each file is scored in chunks, offline, which catches paraphrased and
 * Turkish injections the patterns miss. Like the judge, it only adds findings.
 */
export interface ClassifierScanOptions {
  /** Report at this score or above; default 0.9 (the proxy's default block threshold). */
  threshold?: number;
  /** Characters per chunk; default 2000 (about one 256-token window of the model is scored per ~1000 characters). */
  chunkSize?: number;
}

/** Chunks on line boundaries with their first line number; a line longer than `size` is split, never cut. */
function pieces(text: string, size: number): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let current = "";
  let start = 1;
  text.split("\n").forEach((line, i) => {
    for (let at = 0; at === 0 || at < line.length; at += size) {
      const part = line.slice(at, at + size);
      if (current && current.length + part.length + 1 > size) {
        out.push({ text: current, line: start });
        current = "";
      }
      if (!current) start = i + 1;
      current = current ? `${current}\n${part}` : part;
    }
  });
  if (current.trim()) out.push({ text: current, line: start });
  return out;
}

export async function classifyText(text: string, filePath: string | undefined, classifier: InjectionClassifier, options: ClassifierScanOptions = {}): Promise<Finding[]> {
  const findings: Finding[] = [];
  const parts = pieces(text, options.chunkSize ?? 2000).filter((c) => c.text.trim());
  const scores = await classifier.classify(parts.map((c) => c.text));
  parts.forEach((chunk, i) => {
    const score = scores[i]!;
    if (score < (options.threshold ?? 0.9)) return;
    findings.push({
      patternId: "classifier_injection",
      patternName: "Prompt injection or jailbreak (local classifier)",
      category: "instruction-override",
      severity: "high",
      recommendation: "Content an agent reads should not instruct it. Remove the text, or keep this content away from agents that can act on it.",
      ...(filePath ? { file: filePath } : {}),
      line: chunk.line,
      column: 1,
      match: chunk.text.trim().replace(/\s+/g, " ").slice(0, 160),
      context: "",
      classifier: { model: classifier.model, score: Number(score.toFixed(4)) },
    });
  });
  return findings;
}

export async function classifyFiles(paths: string[], classifier: InjectionClassifier, options: ClassifierScanOptions = {}): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    findings.push(...(await classifyText(text, path, classifier, options)));
  }
  return findings;
}
