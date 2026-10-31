import { randomBytes } from "crypto";
import {
  CLIENT_CAPABILITIES_META_KEY,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  Server,
  type RequestStateCodec,
  type ServerContext,
  type Transport,
} from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { ConsentPages } from "./gateway/consent.js";
import { TokenStore, UpstreamCredentials, type AuthEvents } from "./gateway/upstream-auth.js";
import { isHttpUpstream, type AuditEvent, type McpServerConfig, type ProxyConfig, type UpstreamConfig } from "./types.js";
import { sandboxContext, sandboxIssues } from "./gateway/sandbox.js";
import { AuditLogger } from "./audit/logger.js";
import {
  ApprovalRequired,
  approvalAnswer,
  approvalForm,
  chainApprovers,
  dashboardApprover,
  elicitationApprover,
  type ApprovalOutcome,
  type Approver,
  type DeferredApprovals,
} from "./gateway/approval.js";
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

/** The first revision without sessions or server→client requests. */
export const MODERN_PROTOCOL = "2026-07-28";

/**
 * What an approval round trip carries through a 2026-07-28 client: the
 * answers so far and the approval the client is being asked now. Signed (see
 * approvalStateCodec), so a client cannot make up an answer.
 */
export interface ApprovalState {
  answers: [string, ApprovalOutcome][];
  pending: string;
}

/**
 * HMAC codec for ApprovalState. A random key works while one process serves
 * every round of a call; replicas behind a load balancer share listen.stateKeyEnv.
 * The state is bound to the caller (`authInfo.clientId`, set from the user and
 * context in HTTP mode) so one user's state does not answer another's call.
 */
export function approvalStateCodec(config: GatewayConfig, key?: string): RequestStateCodec<ApprovalState> {
  return createRequestStateCodec<ApprovalState>({
    key: key ?? randomBytes(32),
    ttlSeconds: Math.max(60, config.approval.timeoutSeconds),
    bind: (ctx) => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId ?? ""}`,
  });
}

/** Served on 2026-07-28 or later: per-request envelope, no server→client requests. */
export function isModern(server: Server): boolean {
  const version = server.getNegotiatedProtocolVersion();
  return version !== undefined && version >= MODERN_PROTOCOL;
}

/**
 * The per-call approval context for a 2026-07-28 request: answers from the
 * verified requestState plus the one the client just gave. Undefined on
 * 2025-11-25, where approvals are asked with a real elicitation request.
 */
function deferredFor(server: Server, ctx: ServerContext): DeferredApprovals | undefined {
  if (!isModern(server)) return undefined;
  const state = ctx.mcpReq.requestState<ApprovalState>();
  const answers = new Map<string, ApprovalOutcome>(state?.answers ?? []);
  if (state) {
    const response = inputResponse(ctx.mcpReq.inputResponses, "approve");
    answers.set(state.pending, response.kind === "elicit" ? approvalAnswer(response) : "declined");
  }
  // 2026-07-28 declares capabilities on every request, in its _meta envelope
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const declared = (envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? server.getClientCapabilities()) as { elicitation?: unknown } | undefined;
  return { answers, retry: state !== undefined, canElicit: Boolean(declared?.elicitation) };
}

/** The MCP server the agent talks to; every request goes through the gateway. */
export function createProxyServer(gateway: Gateway, codec: RequestStateCodec<ApprovalState> = approvalStateCodec(gateway.config)): Server {
  const server = new Server(
    { name: "guardbee-security-proxy", version: "1.0.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: {},
        prompts: {},
      },
      // A forged or expired approval state is refused before the handler runs
      requestState: { verify: codec.verify },
    }
  );

  server.setRequestHandler("tools/list", async () => ({ tools: await gateway.listTools() }));
  server.setRequestHandler("tools/call", async (req, ctx) => {
    const deferred = deferredFor(server, ctx);
    try {
      // The upstream may speak another revision than this client: shape the result for this one
      const result = await gateway.callTool(req.params.name, req.params.arguments ?? {}, deferred ? { deferred } : {});
      return server.projectCallToolResult(result, undefined);
    } catch (err) {
      if (!(err instanceof ApprovalRequired) || !deferred) throw err;
      return inputRequired({
        inputRequests: { approve: inputRequired.elicit(approvalForm(err.request)) },
        requestState: await codec.mint({ answers: [...deferred.answers], pending: err.key }, ctx),
      });
    }
  });
  server.setRequestHandler("resources/list", async () => ({ resources: await gateway.listResources() }));
  server.setRequestHandler("resources/read", async (req, ctx) => {
    const deferred = deferredFor(server, ctx);
    return gateway.readResource(req.params.uri, deferred ? { deferred } : {});
  });
  server.setRequestHandler("prompts/list", async () => ({ prompts: await gateway.listPrompts() }));
  server.setRequestHandler("prompts/get", async (req, ctx) => {
    const deferred = deferredFor(server, ctx);
    return gateway.getPrompt(req.params.name, req.params.arguments, deferred ? { deferred } : {});
  });

  return server;
}

/**
 * Approval channels in the configured order. Elicitation goes to the server
 * `current()` returns, the one serving the session's latest request: over
 * 2026-07-28 that is a new instance per request.
 */
export function gatewayApprover(config: GatewayConfig, current: () => Server | undefined): Approver {
  // Read approval settings on every request: a dashboard policy update can change them mid-session.
  return (request) => {
    const { timeoutSeconds, channels } = config.approval;
    return chainApprovers(
      channels.map((channel): Approver =>
        channel === "dashboard" && config.audit.dashboard
          ? dashboardApprover(config.audit.dashboard, timeoutSeconds)
          : (req) => elicitationApprover(current(), timeoutSeconds)(req)
      )
    )(request);
  };
}

/**
 * Servers' sampling requests go to this session's client, when it offers
 * sampling and is on 2025-11-25: on 2026-07-28 a server cannot ask the client
 * in the middle of another server's call.
 */
export function gatewaySampler(current: () => Server | undefined): Sampler {
  return {
    available: () => {
      const server = current();
      return Boolean(server && !isModern(server) && server.getClientCapabilities()?.sampling);
    },
    create: (params) => current()!.createMessage(params),
  };
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
  options: { sessionId?: string; identity?: CallerIdentity; quotas?: QuotaStore; pinStore?: PinStore; codec?: RequestStateCodec<ApprovalState> } = {}
): { gateway: Gateway; server: Server } {
  let server: Server | undefined;
  const { codec = approvalStateCodec(config), ...rest } = options;
  const gateway = new Gateway(upstreams, config, audit, gatewayApprover(config, () => server), { ...rest, sampler: gatewaySampler(() => server) });
  server = createProxyServer(gateway, codec);
  const current = server;
  gateway.onToolsChanged(() => {
    void current.sendToolListChanged().catch(() => {});
  });
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
    const network = sandbox.network === "allowlist" ? `network allowlist: ${(sandbox.allowHosts ?? []).join(", ")}` : `network ${sandbox.network}`;
    process.stderr.write(`[guardbee-proxy] upstream ${name}: sandboxed (${sandbox.runtime}, ${network}, ${fsNote})\n`);
    return upstream;
  } catch (err) {
    const reason = `sandbox ${sandbox.runtime} failed to start: ${err instanceof Error ? err.message : String(err)}`;
    audit.log({ ts: new Date().toISOString(), type: "blocked", upstream: name, ruleId: "sandbox:failed", reason });
    throw err;
  }
}

/**
 * Credential sources of upstreams with auth.mode token-exchange or
 * oauth-per-user, the encrypted token store and the consent pages. Elevations
 * and consents are audit events (type approval, ruleId auth:*).
 */
export function upstreamIdentities(config: GatewayConfig, audit: AuditLogger): { credentials: Map<string, UpstreamCredentials>; consent?: ConsentPages; connected?: (upstream: string) => void } {
  const out: { credentials: Map<string, UpstreamCredentials>; consent?: ConsentPages; connected?: (upstream: string) => void } = { credentials: new Map() };
  const authed = Object.entries(config.upstreams).flatMap(([name, upstream]) =>
    isHttpUpstream(upstream) && upstream.auth && upstream.auth.mode !== "static" ? [[name, upstream.auth] as const] : [],
  );
  if (!authed.length) return out;
  const http = config.listen.transport === "http";
  if (authed.some(([, auth]) => auth.mode === "token-exchange") && !(config.listen.transport === "http" && config.listen.oidc)) {
    throw new Error("auth.mode token-exchange needs callers signed in with OIDC: listen.transport http and listen.oidc");
  }
  const perUser = authed.some(([, auth]) => auth.mode === "oauth-per-user");
  if (perUser && !config.upstreamAuth) throw new Error("auth.mode oauth-per-user needs upstreamAuth (publicUrl, encryptionKeyEnv)");
  if (perUser && !http) throw new Error("auth.mode oauth-per-user needs listen.transport http: the consent page is served by the gateway");
  const log = (event: Omit<AuditEvent, "ts">) => audit.log({ ts: new Date().toISOString(), ...event });
  const events: AuthEvents = {
    onStepUp: ({ upstream, user, from, to, reason }) =>
      log({ type: "approval", ruleId: "auth:step-up", upstream, user, reason: `scope step-up for ${upstream}: ${from.join(" ") || "(none)"} → ${to.join(" ")} (${reason})` }),
  };
  const store = config.upstreamAuth ? new TokenStore(config.upstreamAuth.encryptionKey, config.upstreamAuth.tokenFile) : undefined;
  if (config.upstreamAuth && perUser) {
    out.consent = new ConsentPages({
      publicUrl: config.upstreamAuth.publicUrl,
      key: config.upstreamAuth.encryptionKey,
      credentials: out.credentials,
      onConnected: (upstream) => out.connected?.(upstream),
      onEvent: ({ upstream, user, outcome, reason, scopes }) =>
        log({ type: outcome === "connected" ? "approval" : "warn", ruleId: `auth:consent`, upstream, user, reason: `${upstream} account ${outcome}${scopes ? ` (scopes: ${scopes.join(" ") || "default"})` : ""}${reason ? `: ${reason}` : ""}` }),
    });
  }
  for (const [name, auth] of authed) {
    out.credentials.set(name, new UpstreamCredentials(name, auth, { ...(store ? { store } : {}), ...(out.consent ? { links: out.consent } : {}), events }));
  }
  return out;
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
  const identities = upstreamIdentities(config, audit);
  for (const [name, original] of Object.entries(config.upstreams)) {
    const server = isHttpUpstream(original) ? original : await checkedServer(name, original, config, audit, provenance);
    if (!isHttpUpstream(server)) checkSandbox(name, server, audit);
    const credentials = identities.credentials.get(name);
    upstreams.push(
      await connectSandboxed(name, server, audit, () => connectUpstream(name, server, {
        ...(credentials ? { credentials } : {}),
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
    identities.connected = (upstream) => (upstreams.find((u) => u.name === upstream) as { notifyConnected?: () => void } | undefined)?.notifyConnected?.();
    const http = await startHttpGateway(upstreams, config, audit, config.listen, {
      ...(pinStore ? { pinStore } : {}),
      ...(counters ? { counters } : {}),
      ...(identities.consent ? { consent: identities.consent } : {}),
    });
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

  const { gateway, stdio } = serveGatewayStdio(upstreams, config, audit, {
    ...(pinStore ? { pinStore } : {}),
    ...(counters ? { quotas: new QuotaStore(Date.now, counters) } : {}),
  });

  // The client usually just closes stdin; without this the process ended with
  // audit events still queued for the dashboard.
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await stdio.close().catch(() => {});
    await gateway.close();
    await stopTracing?.();
    process.exit(0);
  };
  process.stdin.on("end", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

/**
 * The gateway over stdio (or `transport`): one agent per process, so one
 * Gateway. serveStdio builds a server for the protocol revision the client
 * opens with (and one for a discovery probe it may discard); each serves this
 * gateway, and the last one built is the live one.
 */
export function serveGatewayStdio(
  upstreams: Upstream[],
  config: GatewayConfig,
  audit: AuditLogger,
  options: { pinStore?: PinStore; quotas?: QuotaStore; transport?: Transport } = {},
): { gateway: Gateway; stdio: StdioServerHandle } {
  const { transport, ...gatewayOptions } = options;
  const codec = approvalStateCodec(config);
  let current: Server | undefined;
  let unsubscribe: (() => void) | undefined;
  const gateway = new Gateway(upstreams, config, audit, gatewayApprover(config, () => current), {
    ...gatewayOptions,
    sampler: gatewaySampler(() => current),
  });
  const stdio = serveStdio(
    () => {
      const server = createProxyServer(gateway, codec);
      unsubscribe?.();
      unsubscribe = gateway.onToolsChanged(() => {
        void server.sendToolListChanged().catch(() => {});
      });
      current = server;
      return server;
    },
    {
      ...(transport ? { transport } : {}),
      onerror: (err) => process.stderr.write(`[guardbee-proxy] ${err.message}\n`),
    },
  );
  return { gateway, stdio };
}

/** 0.x entry point: one server, unprefixed tool names, toxic flows only warn. */
export async function startProxy(config: ProxyConfig): Promise<void> {
  await startGateway(fromLegacyConfig(config));
}
