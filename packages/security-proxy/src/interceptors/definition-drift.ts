import { createHash } from "crypto";

export interface PinFinding {
  kind: "added" | "changed" | "removed";
  toolName: string;
  reason: string;
}

export type ToolRecord = Record<string, unknown> & { name?: unknown };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(rec[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashToolDefinition(tool: ToolRecord): string {
  return createHash("sha256")
    .update(
      stable({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })
    )
    .digest("hex");
}

/**
 * Pins the first tools/list a session sees. Later lists are compared to that
 * pin so a server cannot change a tool's description after the client approved it.
 */
export class ToolDefinitionPin {
  private pinned = new Map<string, { hash: string; tool: ToolRecord }>();
  private ready = false;

  observe(tools: ToolRecord[], action: "block" | "warn"): { tools: ToolRecord[]; findings: PinFinding[] } {
    const named = tools.filter((tool): tool is ToolRecord & { name: string } => typeof tool.name === "string");
    if (!this.ready) {
      for (const tool of named) this.pinned.set(tool.name, { hash: hashToolDefinition(tool), tool });
      this.ready = true;
      return { tools: named, findings: [] };
    }

    const findings: PinFinding[] = [];
    const advertised: ToolRecord[] = [];
    const seen = new Set<string>();

    for (const tool of named) {
      seen.add(tool.name);
      const previous = this.pinned.get(tool.name);
      if (!previous) {
        findings.push({
          kind: "added",
          toolName: tool.name,
          reason: `Tool "${tool.name}" appeared after the session pin (MCP03:2025).`,
        });
        if (action === "warn") advertised.push(tool);
        continue;
      }
      if (hashToolDefinition(tool) !== previous.hash) {
        findings.push({
          kind: "changed",
          toolName: tool.name,
          reason: `Tool "${tool.name}" changed its description or schema during this session (MCP03:2025).`,
        });
        advertised.push(action === "block" ? previous.tool : tool);
        continue;
      }
      advertised.push(tool);
    }

    for (const name of this.pinned.keys()) {
      if (!seen.has(name)) {
        findings.push({
          kind: "removed",
          toolName: name,
          reason: `Tool "${name}" disappeared after the session pin (MCP03:2025).`,
        });
      }
    }

    return { tools: advertised, findings };
  }

  /** Pin the current list when the session has not listed tools yet. Does not emit findings. */
  ensurePinned(tools: ToolRecord[]): void {
    if (!this.ready) this.observe(tools, "block");
  }

  drifted(toolName: string, tools: ToolRecord[]): PinFinding | null {
    const live = tools.find((tool) => tool.name === toolName);
    const previous = this.pinned.get(toolName);
    if (!previous && live) {
      return { kind: "added", toolName, reason: `Tool "${toolName}" was not in the session pin (MCP03:2025).` };
    }
    if (previous && live && hashToolDefinition(live) !== previous.hash) {
      return {
        kind: "changed",
        toolName,
        reason: `Tool "${toolName}" changed during this session (MCP03:2025).`,
      };
    }
    return null;
  }
}
