import { classifyTool, type Capability } from "@guardbee/guard-core";

/** The three legs of the lethal trifecta, plus destructive tools. */
export type Label = "untrusted" | "sensitive" | "egress" | "destructive";

export const LABELS = ["untrusted", "sensitive", "egress", "destructive"] as const;

const FROM_CAPABILITY: Record<Capability, Label> = {
  "untrusted-content": "untrusted",
  "sensitive-data": "sensitive",
  exfiltration: "egress",
  destructive: "destructive",
};

/** Heuristic labels from the tool's name, description and schema (same rules as toxic-flow-auditor). */
export function labelTool(tool: { name: string; description?: string; inputSchema?: unknown }): Label[] {
  return classifyTool(tool).map((capability) => FROM_CAPABILITY[capability]);
}
