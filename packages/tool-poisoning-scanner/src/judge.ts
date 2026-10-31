import { readFileSync } from "fs";
import { languageOf, type AlignmentBehavior, type Judge } from "@guardbee/guard-core";
import { locationOf, toolsOf, type Finding } from "./scanner.js";

/**
 * Description-vs-behavior alignment with an LLM judge (opt-in, --judge):
 * for each tool, the model reads the name, description, readOnlyHint and
 * handler code and lists what the code does that the description does not
 * disclose, quoting the code for each. Catches what the sink rules cannot:
 * a "read-only" tool that calls out to a third party, a description that is
 * merely vague about a destructive handler.
 *
 * The judge only adds findings. The deterministic rules run as before and
 * none of their findings is removed.
 */

export interface JudgeScanOptions {
  /** Report a mismatch only at this confidence or above; default 0.7. */
  minConfidence?: number;
  /** Stop after this many tools (each is one model call); default 200. */
  maxTools?: number;
  /** Called when a call fails; the tool is skipped. */
  onError?: (tool: string, error: Error) => void;
}

const SERIOUS = new Set<AlignmentBehavior>(["process-execution", "code-execution", "credentials-access", "data-exfiltration", "filesystem-write"]);

export async function judgeText(text: string, filePath: string | undefined, judge: Judge, options: JudgeScanOptions & { budget?: { left: number } } = {}): Promise<Finding[]> {
  const language = filePath ? languageOf(filePath) : undefined;
  const findings: Finding[] = [];
  for (const tool of toolsOf(text, language ?? "typescript")) {
    if (options.budget && options.budget.left-- <= 0) break;
    if (!tool.code.length) continue;
    const code = tool.code.map(([start, end]) => text.slice(start, end)).join("\n…\n");
    let verdict;
    try {
      verdict = await judge.checkAlignment({ name: tool.name, description: tool.description?.text ?? "", readOnlyHint: tool.readOnlyHint, code, ...(language ? { language } : {}) });
    } catch (err) {
      options.onError?.(tool.name, err instanceof Error ? err : new Error(String(err)));
      continue;
    }
    if (verdict.aligned || verdict.confidence < (options.minConfidence ?? 0.7)) continue;
    const at = tool.description?.index ?? tool.code[0]![0];
    const { line, column } = locationOf(text, at);
    const behaviors = verdict.undisclosed.map((u) => u.behavior);
    findings.push({
      patternId: "judge_description_behavior_mismatch",
      patternName: `Confused deputy (judge): "${tool.name}" does what its description does not say: ${behaviors.join(", ")}`,
      category: "confused-deputy",
      severity: behaviors.some((b) => SERIOUS.has(b)) ? "high" : "medium",
      recommendation: `The handler ${verdict.undisclosed.map((u) => `${u.behavior} (\`${u.evidence}\`)`).join("; ")} — none of which the description discloses. ${verdict.reason} Describe what the tool really does, or remove the behavior.`,
      owasp: "MCP03:2025",
      ...(language ? { language } : {}),
      ...(filePath ? { file: filePath } : {}),
      line,
      column,
      match: `tool "${tool.name}": ${verdict.undisclosed.map((u) => u.evidence).join(" | ")}`.slice(0, 240),
      context: (tool.description?.text ?? tool.name).trim().slice(0, 240),
      judge: { model: verdict.model.name, ...(verdict.model.version ? { version: verdict.model.version } : {}), confidence: verdict.confidence },
    });
  }
  return findings;
}

/** judgeText over files (the paths a scan returned). */
export async function judgeFiles(paths: string[], judge: Judge, options: JudgeScanOptions = {}): Promise<Finding[]> {
  const budget = { left: options.maxTools ?? 200 };
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
