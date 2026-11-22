import { Client, SSEClientTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
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

/**
 * Connect just long enough to call tools/list (same pattern as rug-pull-detector).
 * An HTTP target with `transport: "auto"` tries Streamable HTTP first and falls
 * back to the legacy SSE transport, as clients do for older servers.
 */
export async function connectAndListTools(target: ConnectionTarget, timeoutMs = 15000): Promise<LiveServerInfo> {
  if (target.type === "http" && target.transport === "auto") {
    try {
      return await connectOnce({ ...target, transport: "streamable" }, timeoutMs);
    } catch (streamableError) {
      try {
        return await connectOnce({ ...target, transport: "sse" }, timeoutMs);
      } catch {
        throw streamableError;
      }
    }
  }
  return connectOnce(target, timeoutMs);
}

async function connectOnce(target: ConnectionTarget, timeoutMs: number): Promise<LiveServerInfo> {
  const client = new Client(
    { name: "guardbee-owasp-scan", version: "0.1.0" },
    // Ask for 2026-07-28 first, fall back to the 2025 handshake: a scan reads servers of either revision
    { capabilities: {}, versionNegotiation: { mode: "auto" } },
  );
  let transport;
  if (target.type === "stdio") {
    // stderr is dropped: a scan of many servers should not interleave their logs with the report
    transport = new StdioClientTransport({ command: target.command, args: target.args, env: target.env, cwd: target.cwd, stderr: "ignore" });
  } else {
    const requestInit = target.headers && Object.keys(target.headers).length > 0 ? { headers: target.headers } : undefined;
    transport =
      target.transport === "sse"
        ? new SSEClientTransport(new URL(target.url), { requestInit })
        : new StreamableHTTPClientTransport(new URL(target.url), { requestInit });
  }

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
