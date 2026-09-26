import { connectAndListTools } from "./mcpClient.js";
import { loadBaseline, saveBaseline, baselinePath as baselineFilePath, listBaselines } from "./baselineStore.js";
import { hashTool, serverIdFromTarget } from "./hashing.js";
import { diffTools, type DriftFinding } from "./diff.js";
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
  findings: DriftFinding[];
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
    if (options.autoBaseline !== false) {
      const now = new Date().toISOString();
      saveBaseline(baseDir, {
        serverId,
        target: label,
        serverInfo,
        capturedAt: now,
        tools: Object.fromEntries(tools.map((t) => [t.name, { hash: hashTool(t), firstSeen: now, snapshot: t }])),
      });
    }
    return { serverId, target: label, toolCount: tools.length, isNewBaseline: true, findings: [] };
  }

  return { serverId, target: label, toolCount: tools.length, isNewBaseline: false, findings: diffTools(existing, tools) };
}

export { listBaselines };
export type { ServerBaseline };
