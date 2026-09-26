import { hashTool } from "./hashing.js";
import type { ToolSnapshot, ServerBaseline } from "./types.js";

export interface DriftFinding {
  patternId: "tool_definition_drift" | "tool_added" | "tool_removed";
  patternName: string;
  severity: "critical" | "medium" | "low";
  toolName: string;
  recommendation: string;
  detail: string;
}

/**
 * Compares a stored baseline against a fresh `tools/list` response. A change
 * to an *existing* tool's definition is the rug-pull case — critical,
 * regardless of which field changed, because the caller approved a specific
 * definition and the server is now presenting something else. A brand new
 * tool is lower severity (could be a legitimate release) but still worth a
 * human look, since nothing stops a server from introducing its dangerous
 * tool only after the benign ones already earned trust.
 */
export function diffTools(baseline: ServerBaseline, currentTools: ToolSnapshot[]): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const currentByName = new Map(currentTools.map((t) => [t.name, t]));

  for (const [name, entry] of Object.entries(baseline.tools)) {
    const current = currentByName.get(name);

    if (!current) {
      findings.push({
        patternId: "tool_removed",
        patternName: `Tool "${name}" present in baseline no longer offered`,
        severity: "low",
        toolName: name,
        recommendation: "Confirm this removal was an intentional server update, not a sign the server's tool set is being manipulated.",
        detail: `Baselined ${entry.firstSeen}; not present in the current tools/list response.`,
      });
      continue;
    }

    const currentHash = hashTool(current);
    if (currentHash === entry.hash) continue;

    const descChanged = (entry.snapshot.description ?? "") !== (current.description ?? "");
    const schemaChanged = JSON.stringify(entry.snapshot.inputSchema ?? null) !== JSON.stringify(current.inputSchema ?? null);
    const outputSchemaChanged = JSON.stringify(entry.snapshot.outputSchema ?? null) !== JSON.stringify(current.outputSchema ?? null);
    const annotationsChanged = JSON.stringify(entry.snapshot.annotations ?? null) !== JSON.stringify(current.annotations ?? null);
    const changedParts = [
      descChanged && "description",
      schemaChanged && "input schema",
      outputSchemaChanged && "output schema",
      annotationsChanged && "annotations",
    ].filter(Boolean) as string[];

    findings.push({
      patternId: "tool_definition_drift",
      patternName: `Tool "${name}" changed since baseline (${changedParts.join(", ") || "unknown field"})`,
      severity: "critical",
      toolName: name,
      recommendation: "This is exactly the \"rug pull\" pattern: a tool approved with one definition now presents differently to callers. Do not assume this is benign — review the actual diff before trusting this server again, and re-approve explicitly if it's a legitimate update.",
      detail: [
        `Baseline description: ${JSON.stringify(entry.snapshot.description ?? null)}`,
        `Current description:  ${JSON.stringify(current.description ?? null)}`,
        schemaChanged ? "Input schema changed." : null,
        outputSchemaChanged ? "Output schema changed." : null,
        annotationsChanged ? "Annotations changed." : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  for (const current of currentTools) {
    if (baseline.tools[current.name]) continue;
    findings.push({
      patternId: "tool_added",
      patternName: `New tool "${current.name}" not present in baseline`,
      severity: "medium",
      toolName: current.name,
      recommendation: "Review this tool before trusting it — confirm it's an expected addition (e.g. a real version update) rather than the server unilaterally expanding its own capability set.",
      detail: `description: ${JSON.stringify(current.description ?? null)}`,
    });
  }

  return findings;
}
