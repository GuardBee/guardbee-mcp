import { connectAndListTools } from "./mcpClient.js";
import { loadBaseline, saveBaseline, baselinePath as baselineFilePath, listBaselines } from "./baselineStore.js";
import { hashTool, serverIdFromTarget } from "./hashing.js";
import { diffTools, type DriftFinding } from "./diff.js";
import { scanToolCatalog, type CatalogFinding } from "@guardbee/mcp-tool-poisoning-scanner";
import type { ConnectionTarget, ServerBaseline } from "./types.js";

export interface BaselineResult {
  serverId: string;
  target: string;
  toolCount: number;
  baselinePath: string;
}

export async function baselineServer(
  target: ConnectionTarget,
  label: string,
  baseDir: string
): Promise<BaselineResult> {
  const { tools, serverInfo } = await connectAndListTools(target);
  const serverId = serverIdFromTarget(label);
  const now = new Date().toISOString();

  const baseline: ServerBaseline = {
    serverId,
    target: label,
    serverInfo,
    capturedAt: now,
    tools: Object.fromEntries(tools.map((t) => [t.name, { hash: hashTool(t), firstSeen: now, snapshot: t }])),
  };
  saveBaseline(baseDir, baseline);

  return { serverId, target: label, toolCount: tools.length, baselinePath: baselineFilePath(baseDir, serverId) };
}

export interface CheckResult {
  serverId: string;
  target: string;
  toolCount: number;
  isNewBaseline: boolean;
  /** True when autoBaseline is off and no baseline exists. Nothing was saved. */
  missingBaseline: boolean;
  findings: DriftFinding[];
  /** Poisoning hits on the live tools/list, including the first time a server is seen. */
  catalogFindings: CatalogFinding[];
}

export async function checkServer(
  target: ConnectionTarget,
  label: string,
  baseDir: string,
  options: { autoBaseline?: boolean } = {}
): Promise<CheckResult> {
  const serverId = serverIdFromTarget(label);
  const existing = loadBaseline(baseDir, serverId);
  const { tools, serverInfo } = await connectAndListTools(target);

  if (!existing) {
    const catalogFindings = scanToolCatalog(tools, label);
    if (options.autoBaseline === false) {
      return {
        serverId,
        target: label,
        toolCount: tools.length,
        isNewBaseline: false,
        missingBaseline: true,
        findings: [],
        catalogFindings,
      };
    }
    const now = new Date().toISOString();
    saveBaseline(baseDir, {
      serverId,
      target: label,
      serverInfo,
      capturedAt: now,
      tools: Object.fromEntries(tools.map((t) => [t.name, { hash: hashTool(t), firstSeen: now, snapshot: t }])),
    });
    return { serverId, target: label, toolCount: tools.length, isNewBaseline: true, missingBaseline: false, findings: [], catalogFindings };
  }

  return {
    serverId,
    target: label,
    toolCount: tools.length,
    isNewBaseline: false,
    missingBaseline: false,
    findings: diffTools(existing, tools),
    catalogFindings: scanToolCatalog(tools, label),
  };
}

export { listBaselines };
export type { ServerBaseline };
