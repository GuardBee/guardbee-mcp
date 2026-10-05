import type { CallToolResult, Resource } from "@modelcontextprotocol/sdk/types.js";
import type { Upstream } from "../gateway/upstream.js";
import type { GatewayConfig } from "../gateway/config.js";

export interface FakeTool {
  name: string;
  description?: string;
  /** Text the tool returns. */
  returns?: string;
  structured?: Record<string, unknown>;
}

export interface FakeUpstream extends Upstream {
  calls: { tool: string; args: Record<string, unknown> }[];
  /** Replace a tool's description to simulate a rug pull. */
  redefine(tool: string, description: string): void;
  /** How many times tools/list was called. */
  listCount(): number;
  /** Fire the tools/list_changed notification. */
  emitToolsChanged(): void;
}

export function fakeUpstream(
  name: string,
  tools: FakeTool[],
  resources: (Resource & { text: string })[] = [],
): FakeUpstream {
  const defs = tools.map((tool) => ({ ...tool }));
  const calls: FakeUpstream["calls"] = [];
  const listeners: (() => void)[] = [];
  let lists = 0;
  return {
    name,
    calls,
    listCount: () => lists,
    emitToolsChanged() {
      for (const listener of listeners) listener();
    },
    onToolsChanged(listener) {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    redefine(tool, description) {
      const def = defs.find((d) => d.name === tool);
      if (def) def.description = description;
    },
    async listTools() {
      lists++;
      return defs.map((d) => ({ name: d.name, description: d.description, inputSchema: { type: "object" as const } }));
    },
    async callTool(tool, args): Promise<CallToolResult> {
      calls.push({ tool, args });
      const def = defs.find((d) => d.name === tool);
      return {
        content: [{ type: "text", text: def?.returns ?? "ok" }],
        ...(def?.structured ? { structuredContent: def.structured } : {}),
      };
    },
    async listResources() {
      return resources.map(({ text: _text, ...resource }) => resource);
    },
    async readResource(uri) {
      const resource = resources.find((r) => r.uri === uri);
      if (!resource) throw new Error(`no resource ${uri}`);
      return { contents: [{ uri, mimeType: "text/plain", text: resource.text }] };
    },
    async listPrompts() {
      return [{ name: "summarize", description: "Summarize a document" }];
    },
    async getPrompt(prompt) {
      return { messages: [{ role: "user", content: { type: "text", text: `${name}:${prompt}` } }] };
    },
    async close() {},
  };
}

export function gatewayConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    upstreams: {},
    policy: { source: "local" },
    namespaced: true,
    labels: {},
    rules: [],
    taint: { mode: "strict", basis: "capability" },
    approval: { timeoutSeconds: 120, channels: ["elicitation"] },
    defaults: { action: "allow" },
    audit: { enabled: false, sink: "console" },
    interceptors: {},
    ...overrides,
  };
}

export function textOf(result: CallToolResult): string {
  return result.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
}
