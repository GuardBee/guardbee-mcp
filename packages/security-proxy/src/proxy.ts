import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ProxyConfig } from "./types.js";
import { AuditLogger } from "./audit/logger.js";
import { elicitationApprover, type Approver } from "./gateway/approval.js";
import { fromLegacyConfig, type GatewayConfig } from "./gateway/config.js";
import { Gateway } from "./gateway/gateway.js";
import { connectStdioUpstream, type Upstream } from "./gateway/upstream.js";

/** The MCP server the agent talks to; every request goes through the gateway. */
export function createProxyServer(gateway: Gateway): Server {
  const server = new Server(
    { name: "guardbee-security-proxy", version: "1.0.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: {},
        prompts: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await gateway.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    gateway.callTool(req.params.name, req.params.arguments ?? {})
  );
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: await gateway.listResources() }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => gateway.readResource(req.params.uri));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: await gateway.listPrompts() }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) =>
    gateway.getPrompt(req.params.name, req.params.arguments)
  );
  gateway.onToolsChanged(() => {
    void server.sendToolListChanged().catch(() => {});
  });

  return server;
}

/**
 * Gateway + the MCP server in front of it, with approvals asked through that
 * server (MCP elicitation). The approver needs the server and the server needs
 * the gateway, hence the late binding.
 */
export function createGatewayServer(
  upstreams: Upstream[],
  config: GatewayConfig,
  audit: AuditLogger
): { gateway: Gateway; server: Server } {
  let server: Server | undefined;
  const approver: Approver = (request) =>
    server ? elicitationApprover(server, config.approval.timeoutSeconds)(request) : Promise.resolve("unavailable");
  const gateway = new Gateway(upstreams, config, audit, approver);
  server = createProxyServer(gateway);
  return { gateway, server };
}

export async function startGateway(config: GatewayConfig): Promise<void> {
  const audit = new AuditLogger(config.audit);
  const upstreams: Upstream[] = [];
  for (const [name, server] of Object.entries(config.upstreams)) {
    upstreams.push(await connectStdioUpstream(name, server));
  }

  const { gateway, server } = createGatewayServer(upstreams, config, audit);
  await server.connect(new StdioServerTransport());

  process.on("SIGINT", async () => {
    await server.close();
    await gateway.close();
    process.exit(0);
  });
}

/** 0.x entry point: one server, unprefixed tool names, toxic flows only warn. */
export async function startProxy(config: ProxyConfig): Promise<void> {
  await startGateway(fromLegacyConfig(config));
}
