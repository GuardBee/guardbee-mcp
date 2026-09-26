export interface ToolSnapshot {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

export interface ToolBaselineEntry {
  hash: string;
  firstSeen: string;
  snapshot: ToolSnapshot;
}

export interface ServerBaseline {
  serverId: string;
  /** Human-readable identifier of what was connected to (a stdio command line, or a URL) — how a baseline is looked up. */
  target: string;
  serverInfo?: { name: string; version: string };
  capturedAt: string;
  tools: Record<string, ToolBaselineEntry>;
}

export type ConnectionTarget =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "http"; url: string };
