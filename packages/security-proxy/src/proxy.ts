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
import { isHttpUpstream, type McpServerConfig, type ProxyConfig, type UpstreamConfig } from "./types.js";
import { sandboxContext, sandboxIssues } from "./gateway/sandbox.js";
import { AuditLogger } from "./audit/logger.js";
import { chainApprovers, dashboardApprover, elicitationApprover, type Approver } from "./gateway/approval.js";
import { fromLegacyConfig, type GatewayConfig } from "./gateway/config.js";
import { Gateway, type CallerIdentity, type Sampler } from "./gateway/gateway.js";
import { connectUpstream, type Upstream } from "./gateway/upstream.js";
import { PinStore, defaultPinFile } from "./gateway/pin-store.js";
import { ProvenanceCache, checkUpstreamProvenance, defaultProvenanceCache, sigstoreVerifier, type CheckOptions } from "./gateway/provenance.js";
import { PolicySync } from "./gateway/policy-sync.js";
import { QuotaStore } from "./gateway/quota.js";
import { RedisClient } from "./state/redis.js";
import { RedisCounters, ResilientCounters, type CounterBackend } from "./state/counters.js";
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
  options: { sessionId?: string; identity?: CallerIdentity; quotas?: QuotaStore; pinStore?: PinStore } = {}
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

/**
 * The persistent pin store, when tool definitions are pinned across restarts:
 * gateway mode with definitionDrift on (persist defaults to true). The
 * single-server `--` form keeps per-session pins only.
 */
function persistentPins(config: GatewayConfig): PinStore | undefined {
  const drift = config.interceptors.definitionDrift;
  if (!config.namespaced || drift?.enabled === false || drift?.persist === false) return undefined;
  return new PinStore(config.pins?.file ?? defaultPinFile());
}

export function provenanceChecker(config: GatewayConfig): CheckOptions {
  const { offline, cacheFile, registry, pypiIndex, signers } = config.provenance;
  return {
    verifyBundle: sigstoreVerifier({ offline }),
    cache: new ProvenanceCache(cacheFile ?? defaultProvenanceCache()),
    offline,
    ...(registry ? { registry } : {}),
    ...(pypiIndex ? { pypiIndex } : {}),
    ...(signers ? { signers } : {}),
  };
}

/**
 * The stdio upstream as it may start: checked for build provenance and pinned
 * to the checked version. Refused (require) or doubtful (warn) packages are
 * audit events with ruleId provenance:<status>.
 */
async function checkedServer(name: string, server: McpServerConfig, config: GatewayConfig, audit: AuditLogger, options: CheckOptions): Promise<McpServerConfig> {
  const mode = server.provenance ?? config.provenance.mode;
  const checked = await checkUpstreamProvenance(server, mode, options);
  const result = checked.result;
  if (!result) return checked.server;
  const where = `[guardbee-proxy] provenance ${name}: ${result.artifact}`;
  if (checked.action === "allow") {
    process.stderr.write(`${where} ${result.reason}\n`);
    return checked.server;
  }
  audit.log({
    ts: new Date().toISOString(),
    type: checked.action === "block" ? "blocked" : "warn",
    upstream: name,
    ruleId: `provenance:${result.status}`,
    reason: `${result.artifact}: ${result.reason}`,
  });
  if (checked.action === "block") throw new Error(`${where} refused (provenance: require): ${result.reason}`);
  process.stderr.write(`${where} not verified: ${result.reason}\n`);
  return checked.server;
}

/**
 * Quota and budget counters in Redis when `state.backend: redis`, with the
 * outage rule of `state.onError`; undefined → each process counts alone.
 */
function sharedCounters(config: GatewayConfig, audit: AuditLogger): CounterBackend | undefined {
  const state = config.state;
  if (!state || state.backend !== "redis" || !state.url) return undefined;
  const client = new RedisClient(state.url, { timeoutMs: state.timeoutMs });
  const now = () => new Date().toISOString();
  process.stderr.write(`[guardbee-proxy] quotas and budgets shared through ${client.target} (onError: ${state.onError})\n`);
  return new ResilientCounters(new RedisCounters(client, state.keyPrefix), state.onError, {
    onOutage: (err) =>
      audit.log({
        ts: now(),
        type: "warn",
        ruleId: "state:unavailable",
        reason: `${client.target} unreachable (${err instanceof Error ? err.message : String(err)}); ${state.onError === "local" ? "counting in this process until it is back" : state.onError === "fail-open" ? "quotas and budgets not enforced until it is back" : "calls with a quota or budget refused until it is back"}`,
      }),
    onRecovery: () => audit.log({ ts: now(), type: "warn", ruleId: "state:recovered", reason: `${client.target} reachable again` }),
  });
}

/** Refuse to start a sandbox that cannot work here (runtime missing, credential path exposed…): never fall back to no sandbox. */
function checkSandbox(name: string, server: McpServerConfig, audit: AuditLogger): void {
  if (!server.sandbox || server.sandbox.runtime === "none") return;
  const issues = sandboxIssues(server, server.sandbox, sandboxContext(name));
  if (issues.length === 0) return;
  const reason = `sandbox ${server.sandbox.runtime}: ${issues.join("; ")}`;
  audit.log({ ts: new Date().toISOString(), type: "blocked", upstream: name, ruleId: "sandbox:invalid", reason });
  throw new Error(`[guardbee-proxy] upstream ${name}: ${reason}`);
}

async function connectSandboxed(name: string, server: UpstreamConfig, audit: AuditLogger, connect: () => Promise<Upstream>): Promise<Upstream> {
  const sandbox = isHttpUpstream(server) ? undefined : server.sandbox;
  if (!sandbox || sandbox.runtime === "none") return connect();
  try {
    const upstream = await connect();
    const fsNote = sandbox.fs.readWrite.length ? `writable: ${sandbox.fs.readWrite.join(", ")}` : "read-only";
    process.stderr.write(`[guardbee-proxy] upstream ${name}: sandboxed (${sandbox.runtime}, network ${sandbox.network}, ${fsNote})\n`);
    return upstream;
  } catch (err) {
    const reason = `sandbox ${sandbox.runtime} failed to start: ${err instanceof Error ? err.message : String(err)}`;
    audit.log({ ts: new Date().toISOString(), type: "blocked", upstream: name, ruleId: "sandbox:failed", reason });
    throw err;
  }
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
  const pinStore = persistentPins(config);
  const counters = sharedCounters(config, audit);
  const upstreams: Upstream[] = [];
  const provenance = provenanceChecker(config);
  for (const [name, original] of Object.entries(config.upstreams)) {
    const server = isHttpUpstream(original) ? original : await checkedServer(name, original, config, audit, provenance);
    if (!isHttpUpstream(server)) checkSandbox(name, server, audit);
    upstreams.push(
      await connectSandboxed(name, server, audit, () => connectUpstream(name, server, {
        sampling: config.interceptors.sampling?.enabled === true,
        onEgressBlocked: (error) =>
          audit.log({
            ts: new Date().toISOString(),
            type: "blocked",
            upstream: name,
            ruleId: error.rule,
            reason: error.message,
            destination: { host: error.host, ...(error.address ? { address: error.address } : {}) },
          }),
      })),
    );
  }

  if (config.listen.transport === "http") {
    // Imported here: http-server.ts imports this module for createGatewayServer.
    const { startHttpGateway } = await import("./http-server.js");
    const http = await startHttpGateway(upstreams, config, audit, config.listen, { ...(pinStore ? { pinStore } : {}), ...(counters ? { counters } : {}) });
    process.stderr.write(`[guardbee-proxy] listening on ${http.url}\n`);
    if (http.llmUrl) process.stderr.write(`[guardbee-proxy] LLM gateway on ${http.llmUrl} (chat/completions, messages, models)\n`);
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

  const { gateway, server } = createGatewayServer(upstreams, config, audit, { ...(pinStore ? { pinStore } : {}), ...(counters ? { quotas: new QuotaStore(Date.now, counters) } : {}) });
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
