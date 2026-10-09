import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ConnectionTarget } from "./types.js";

export interface LiveTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

export interface LiveServerInfo {
  serverInfo?: { name: string; version: string };
  tools: LiveTool[];
}

/** Connect just long enough to call tools/list (same pattern as rug-pull-detector). */
export async function connectAndListTools(target: ConnectionTarget, timeoutMs = 15000): Promise<LiveServerInfo> {
  const client = new Client({ name: "guardbee-owasp-scan", version: "0.1.0" }, { capabilities: {} });
  const transport =
    target.type === "stdio"
      ? new StdioClientTransport({ command: target.command, args: target.args, env: target.env, cwd: target.cwd })
      : new StreamableHTTPClientTransport(new URL(target.url));

  try {
    await withTimeout(client.connect(transport), timeoutMs, "Connecting to the server");
    const serverVersion = client.getServerVersion();
    const { tools } = await withTimeout(client.listTools(), timeoutMs, "Listing tools");

    return {
      serverInfo: serverVersion ? { name: serverVersion.name, version: serverVersion.version } : undefined,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      })),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)),
  ]);
}
