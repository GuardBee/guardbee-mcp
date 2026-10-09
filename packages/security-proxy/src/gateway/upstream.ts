import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CreateMessageRequestSchema, ErrorCode, McpError, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  CreateMessageRequest,
  CreateMessageResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { isHttpUpstream, type HttpUpstreamConfig, type McpServerConfig, type UpstreamConfig } from "../types.js";

/** Answers a server's sampling/createMessage request on behalf of one session. */
export type SamplingHandler = (params: CreateMessageRequest["params"]) => Promise<CreateMessageResult>;

export interface CallOptions {
  /**
   * Sampling requests the server sends while this call runs go here. `owner`
   * identifies the session: concurrent calls from one session are fine, from
   * two sessions the request could belong to either and is refused.
   */
  sampling?: { owner: object; handler: SamplingHandler };
}

/** One MCP server behind the gateway. */
export interface Upstream {
  readonly name: string;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: CallOptions): Promise<CallToolResult>;
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
export function clientUpstream(name: string, client: Client, options: { sampling?: boolean } = {}): Upstream {
  const caps = () => client.getServerCapabilities() ?? {};
  // Calls in flight that can answer sampling, newest last.
  const active: NonNullable<CallOptions["sampling"]>[] = [];
  if (options.sampling) {
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      const owners = new Set(active.map((entry) => entry.owner));
      if (owners.size === 0) {
        throw new McpError(ErrorCode.InvalidRequest, "GuardBee gateway: sampling is only answered while one of this server's tool calls is running");
      }
      if (owners.size > 1) {
        throw new McpError(ErrorCode.InvalidRequest, "GuardBee gateway: several sessions are calling this server; cannot tell which one asked for sampling");
      }
      return active[active.length - 1]!.handler(request.params);
    });
  }
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
    async callTool(tool, args, options) {
      const sampling = options?.sampling;
      if (sampling) active.push(sampling);
      try {
        return (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
      } finally {
        if (sampling) active.splice(active.indexOf(sampling), 1);
      }
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

/** Only offer sampling to servers when interceptors.sampling is on: a server may change course when it sees the capability. */
function proxyClient(sampling: boolean): Client {
  return new Client({ name: "guardbee-proxy-client", version: "1.0.0" }, { capabilities: sampling ? { sampling: {} } : {} });
}

export async function connectHttpUpstream(name: string, server: HttpUpstreamConfig, options: { sampling?: boolean } = {}): Promise<Upstream> {
  const client = proxyClient(options.sampling ?? false);
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: server.headers ? { headers: server.headers } : undefined,
  });
  await client.connect(transport);
  return clientUpstream(name, client, options);
}

export function connectUpstream(name: string, server: UpstreamConfig, options: { sampling?: boolean } = {}): Promise<Upstream> {
  return isHttpUpstream(server) ? connectHttpUpstream(name, server, options) : connectStdioUpstream(name, server, options);
}

export async function connectStdioUpstream(name: string, server: McpServerConfig, options: { sampling?: boolean } = {}): Promise<Upstream> {
  const client = proxyClient(options.sampling ?? false);
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
  });
  await client.connect(transport);
  return clientUpstream(name, client, options);
}
