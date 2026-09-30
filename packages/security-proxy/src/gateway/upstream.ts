import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  CallToolResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "../types.js";

/** One MCP server behind the gateway. */
export interface Upstream {
  readonly name: string;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  listResources(): Promise<Resource[]>;
  readResource(uri: string): Promise<ReadResourceResult>;
  listPrompts(): Promise<Prompt[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;
  close(): Promise<void>;
}

/** Wrap a connected MCP client. Resources and prompts are empty when the server does not offer them. */
export function clientUpstream(name: string, client: Client): Upstream {
  const caps = () => client.getServerCapabilities() ?? {};
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
    close() {
      return client.close();
    },
  };
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
