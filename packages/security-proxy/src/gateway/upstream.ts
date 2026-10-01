import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { isHttpUpstream, type HttpUpstreamConfig, type McpServerConfig, type UpstreamConfig } from "../types.js";

/** One MCP server behind the gateway. */
export interface Upstream {
  readonly name: string;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  listResources(): Promise<Resource[]>;
  readResource(uri: string): Promise<ReadResourceResult>;
  listPrompts(): Promise<Prompt[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;
  /**
   * Register for the server's tools/list_changed notification. Several
   * sessions share one upstream, so each gets its own listener; the returned
   * function removes it.
   */
  onToolsChanged?(listener: () => void): () => void;
  close(): Promise<void>;
}

/** Wrap a connected MCP client. Resources and prompts are empty when the server does not offer them. */
export function clientUpstream(name: string, client: Client): Upstream {
  const caps = () => client.getServerCapabilities() ?? {};
  // The client keeps one handler per notification type: fan out from it.
  const toolListeners = new Set<() => void>();
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    for (const listener of toolListeners) listener();
  });
  return {
    name,
    async listTools() {
      return (await client.listTools()).tools;
    },
    async callTool(tool, args) {
      return (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
    },
    async listResources() {
      return caps().resources ? (await client.listResources()).resources : [];
    },
    readResource(uri) {
      return client.readResource({ uri });
    },
    async listPrompts() {
      return caps().prompts ? (await client.listPrompts()).prompts : [];
    },
    getPrompt(prompt, args) {
      return client.getPrompt({ name: prompt, arguments: args });
    },
    onToolsChanged(listener) {
      toolListeners.add(listener);
      return () => toolListeners.delete(listener);
    },
    close() {
      return client.close();
    },
  };
}

export async function connectHttpUpstream(name: string, server: HttpUpstreamConfig): Promise<Upstream> {
  const client = new Client({ name: "guardbee-proxy-client", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: server.headers ? { headers: server.headers } : undefined,
  });
  await client.connect(transport);
  return clientUpstream(name, client);
}

export function connectUpstream(name: string, server: UpstreamConfig): Promise<Upstream> {
  return isHttpUpstream(server) ? connectHttpUpstream(name, server) : connectStdioUpstream(name, server);
}

export async function connectStdioUpstream(name: string, server: McpServerConfig): Promise<Upstream> {
  const client = new Client({ name: "guardbee-proxy-client", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
  });
  await client.connect(transport);
  return clientUpstream(name, client);
}
