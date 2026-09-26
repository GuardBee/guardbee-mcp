import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ConnectionTarget, ToolSnapshot } from "./types.js";

export interface LiveServerInfo {
  serverInfo?: { name: string; version: string };
  tools: ToolSnapshot[];
}

/**
 * Connects to a target MCP server (spawning it over stdio, or opening a
 * Streamable HTTP session) just long enough to call `tools/list`, then
 * disconnects. This is the same connection any MCP client makes — the point
 * isn't to sandbox the server, it's to read what it *currently* claims its
 * tools are, so it can be compared against what it claimed before.
 */
export async function connectAndListTools(target: ConnectionTarget, timeoutMs = 15000): Promise<LiveServerInfo> {
  const client = new Client({ name: "guardbee-rug-pull-detector", version: "0.1.0" }, { capabilities: {} });
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
        outputSchema: t.outputSchema,
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
