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
import { chainApprovers, dashboardApprover, elicitationApprover, type Approver } from "./gateway/approval.js";
import { fromLegacyConfig, type GatewayConfig } from "./gateway/config.js";
import { Gateway, type CallerIdentity, type Sampler } from "./gateway/gateway.js";
import { connectUpstream, type Upstream } from "./gateway/upstream.js";
import { PolicySync } from "./gateway/policy-sync.js";
import { readFileSync } from "fs";
import { join } from "path";
import { startTracing } from "./tracing.js";

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
  audit: AuditLogger,
  options: { sessionId?: string; identity?: CallerIdentity } = {}
): { gateway: Gateway; server: Server } {
  let server: Server | undefined;
  // Read approval settings on every request: a dashboard policy update can change them mid-session.
  const approver: Approver = (request) => {
    const { timeoutSeconds, channels } = config.approval;
    return chainApprovers(
      channels.map((channel): Approver =>
        channel === "dashboard" && config.audit.dashboard
          ? dashboardApprover(config.audit.dashboard, timeoutSeconds)
          : (req) => (server ? elicitationApprover(server, timeoutSeconds)(req) : Promise.resolve("unavailable"))
      )
    )(request);
  };
  // Servers' sampling requests go to this session's client, when it offers sampling
  const sampler: Sampler = {
    available: () => Boolean(server?.getClientCapabilities()?.sampling),
    create: (params) => server!.createMessage(params),
  };
  const gateway = new Gateway(upstreams, config, audit, approver, { ...options, sampler });
  server = createProxyServer(gateway);
  return { gateway, server };
}

export async function startGateway(config: GatewayConfig): Promise<void> {
  const { version } = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string };
  // OTLP export when OTEL_EXPORTER_OTLP_ENDPOINT is set and the SDK is installed
  const stopTracing = await startTracing({ version });
  const audit = new AuditLogger(config.audit);
  // Start with the dashboard policy when there is one; refresh in the background.
  if (config.policy.source === "dashboard" && config.audit.dashboard) {
    await new PolicySync(config, config.audit.dashboard, config.policy.refreshSeconds).start();
  }
  const upstreams: Upstream[] = [];
  for (const [name, server] of Object.entries(config.upstreams)) {
    upstreams.push(await connectUpstream(name, server, { sampling: config.interceptors.sampling?.enabled === true }));
  }

  if (config.listen.transport === "http") {
    // Imported here: http-server.ts imports this module for createGatewayServer.
    const { startHttpGateway } = await import("./http-server.js");
    const http = await startHttpGateway(upstreams, config, audit, config.listen);
    process.stderr.write(`[guardbee-proxy] listening on ${http.url}\n`);
    const shutdown = async () => {
      await http.close();
      await audit.close();
      await Promise.allSettled(upstreams.map((upstream) => upstream.close()));
      await stopTracing?.();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const { gateway, server } = createGatewayServer(upstreams, config, audit);
  await server.connect(new StdioServerTransport());

  // The client usually just closes stdin; without this the process ended with
  // audit events still queued for the dashboard.
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => {});
    await gateway.close();
    await stopTracing?.();
    process.exit(0);
  };
  server.onclose = () => void shutdown();
  process.stdin.on("end", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

/** 0.x entry point: one server, unprefixed tool names, toxic flows only warn. */
export async function startProxy(config: ProxyConfig): Promise<void> {
  await startGateway(fromLegacyConfig(config));
}
