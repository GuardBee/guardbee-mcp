import http from "http";
import { randomUUID } from "crypto";
import { createMcpHandler, isInitializeRequest, isLegacyRequest, type AuthInfo } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import type { AuditLogger } from "./audit/logger.js";
import { createAuthenticator, type Authenticate, type Identity } from "./auth.js";
import type { GatewayConfig, ListenConfig } from "./gateway/config.js";
import { QuotaStore } from "./gateway/quota.js";
import { BudgetStore } from "./llm/budget.js";
import type { CounterBackend } from "./state/counters.js";
import type { Upstream } from "./gateway/upstream.js";
import { approvalStateCodec, createGatewayServer, createProxyServer, gatewayApprover, gatewaySampler } from "./proxy.js";
import { Gateway } from "./gateway/gateway.js";
import type { PinStore } from "./gateway/pin-store.js";
import { createLlmHandler, type LlmHandler } from "./llm/gateway.js";
import { createDirectory, withDirectoryGroups, type ClientFactory } from "./directory.js";

type HttpListen = Extract<ListenConfig, { transport: "http" }>;

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpGateway {
  /** Base URL of the MCP endpoint, e.g. http://127.0.0.1:8787/mcp */
  url: string;
  /** Base URL of the LLM endpoints when llm is configured, e.g. http://127.0.0.1:8787/v1 */
  llmUrl?: string;
  /** Open 2025-11-25 sessions. */
  sessionCount(): number;
  /** Live 2026-07-28 contexts (see listen.contextIdleSeconds). */
  contextCount(): number;
  close(): Promise<void>;
}

interface Session {
  transport: NodeStreamableHTTPServerTransport;
  gateway: Gateway;
  /** Who opened it; with OIDC only that user may continue it. */
  user?: string;
}

/**
 * What 2026-07-28 calls share in place of a session: the Gateway (taint, PII
 * tokens, pins, anomaly counters) of one user and X-GuardBee-Context value.
 */
interface Context {
  gateway: Gateway;
  lastUsed: number;
}

/** Optional client-chosen name for a separate context, e.g. one per agent conversation. */
export const CONTEXT_HEADER = "x-guardbee-context";
const CONTEXT_VALUE = /^[A-Za-z0-9._:-]{1,128}$/;
/** Requests that use no gateway state: they get no context of their own. */
const STATELESS_METHODS = new Set(["server/discover", "subscriptions/listen"]);

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function jsonRpcError(res: http.ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * The proxy as a Streamable HTTP MCP server. Every MCP session gets its own
 * Gateway — taint, PII tokens and tool pins never leak between sessions —
 * while all sessions share the upstream connections.
 */
export async function startHttpGateway(
  upstreams: Upstream[],
  config: GatewayConfig,
  audit: AuditLogger,
  listen: HttpListen,
  options: { authenticate?: Authenticate; fetchImpl?: typeof fetch; ldapClient?: ClientFactory; pinStore?: PinStore; counters?: CounterBackend } = {},
): Promise<HttpGateway> {
  const sessions = new Map<string, Session>();
  // One set of quota counters for every session of this process (or of every replica, with state.backend: redis)
  const quotas = new QuotaStore(Date.now, options.counters);
  const tokenAuth = options.authenticate ?? createAuthenticator(listen.apiKeys, listen.oidc);
  // The directory adds groups to a known user; it never makes a caller known
  const directory = listen.ldap ? createDirectory(listen.ldap, options.ldapClient) : null;
  const groupsFor = (user: string | undefined, groups: string[]) => withDirectoryGroups(directory, listen.ldap?.onError ?? "deny", user, groups);
  const authenticate: Authenticate = async (authorization) => {
    const identity = await tokenAuth(authorization);
    return identity ? { ...identity, groups: await groupsFor(identity.user, identity.groups) } : null;
  };
  const metadataPath = `/.well-known/oauth-protected-resource${listen.path}`;
  const llm: LlmHandler | null = config.llm
    ? createLlmHandler({
        llm: config.llm,
        config,
        audit,
        groupsFor,
        // With virtual keys and no listen keys, an unknown key must not pass as the open loopback listener
        authenticate: listen.apiKeys.length > 0 || listen.oidc || config.llm.keys.length === 0 ? authenticate : null,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.counters ? { budgets: new BudgetStore(Date.now, options.counters) } : {}),
      })
    : null;

  /** This gateway's public URL: configured, or from the request (behind a proxy, set oidc.resource). */
  const resourceUrl = (req: http.IncomingMessage): string => {
    if (listen.oidc?.resource) return listen.oidc.resource;
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
    return `${proto}://${req.headers.host ?? `${listen.host}:${listen.port}`}${listen.path}`;
  };

  /** RFC 9728: an MCP client finds the authorization server from the 401. */
  const challenge = (req: http.IncomingMessage): Record<string, string> => {
    if (!listen.oidc) return { "www-authenticate": "Bearer" };
    const origin = new URL(resourceUrl(req)).origin;
    return { "www-authenticate": `Bearer resource_metadata="${origin}${metadataPath}"` };
  };

  const openSession = async (req: http.IncomingMessage, res: http.ServerResponse, body: unknown, identity: Identity): Promise<void> => {
    // Sessions and 2026-07-28 contexts share the cap
    if (sessions.size + contexts.size >= listen.maxSessions) {
      jsonRpcError(res, 503, `Too many sessions and contexts (listen.maxSessions=${listen.maxSessions})`);
      return;
    }
    const sessionId = randomUUID();
    const { gateway, server } = createGatewayServer(upstreams, config, audit, {
      sessionId,
      quotas,
      codec,
      ...(options.pinStore ? { pinStore: options.pinStore } : {}),
      ...(identity.user ? { identity: { user: identity.user, groups: identity.groups } } : {}),
    });
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessioninitialized: (id: string) => {
        sessions.set(id, { transport, gateway, ...(identity.user ? { user: identity.user } : {}) });
      },
    });
    transport.onclose = () => {
      sessions.delete(sessionId);
      gateway.dispose();
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  // ── 2026-07-28: no sessions; one Gateway per user and context, a server per request ──
  const codec = approvalStateCodec(config, listen.stateKey);
  const contexts = new Map<string, Context>();
  const newGateway = (user: string | undefined) =>
    new Gateway(upstreams, config, audit, gatewayApprover(config, () => undefined), {
      quotas,
      sampler: gatewaySampler(() => undefined),
      ...(options.pinStore ? { pinStore: options.pinStore } : {}),
      ...(user !== undefined ? { identity: { user, groups: [] } } : {}),
    });
  /** Serves discovery and subscription streams, which never reach the gateway's handlers. */
  let stateless: Gateway | undefined;
  const idleMs = (listen.contextIdleSeconds ?? 1800) * 1000;
  const sweep = () => {
    const now = Date.now();
    for (const [key, context] of contexts) {
      if (now - context.lastUsed > idleMs) {
        contexts.delete(key);
        context.gateway.dispose();
      }
    }
  };
  const sweeper = setInterval(sweep, Math.min(idleMs, 60_000));
  sweeper.unref();

  type ContextAuth = AuthInfo & { extra: { gateway: Gateway } };
  const modern = createMcpHandler(
    (ctx) => createProxyServer((ctx.authInfo as ContextAuth | undefined)?.extra.gateway ?? (stateless ??= newGateway(undefined)), codec),
    { legacy: "reject", maxRequestBodySize: MAX_BODY_BYTES },
  );
  const serveModern = toNodeHandler(modern, { maxRequestBodySize: MAX_BODY_BYTES });
  // Subscribed 2026-07-28 clients hear about tool list changes once, whichever context they use
  for (const upstream of upstreams) upstream.onToolsChanged?.(() => modern.notify.toolsChanged());

  /**
   * The context for this caller. Groups come from the token (and directory)
   * on every request, so a changed group membership applies at once.
   */
  const contextFor = (identity: Identity, name: string | undefined): Gateway | "full" => {
    const key = JSON.stringify([identity.user ?? null, name ?? null]);
    let context = contexts.get(key);
    if (!context) {
      if (sessions.size + contexts.size >= listen.maxSessions) sweep();
      if (sessions.size + contexts.size >= listen.maxSessions) return "full";
      context = { gateway: newGateway(identity.user), lastUsed: Date.now() };
      contexts.set(key, context);
    }
    context.lastUsed = Date.now();
    context.gateway.setIdentity(identity.user !== undefined ? { user: identity.user, groups: identity.groups } : undefined);
    return context.gateway;
  };

  const handleModern = async (req: http.IncomingMessage, res: http.ServerResponse, body: unknown, identity: Identity): Promise<void> => {
    // Mcp-Method routes before the body is looked at; the SDK checks it matches the body (-32020)
    const method = header(req, "mcp-method");
    let gateway: Gateway | undefined;
    if (!method || !STATELESS_METHODS.has(method)) {
      const name = header(req, CONTEXT_HEADER);
      if (name !== undefined && !CONTEXT_VALUE.test(name)) {
        jsonRpcError(res, 400, `${CONTEXT_HEADER} must be 1–128 letters, digits or . _ : -`);
        return;
      }
      const context = contextFor(identity, name);
      if (context === "full") {
        jsonRpcError(res, 503, `Too many sessions and contexts (listen.maxSessions=${listen.maxSessions})`);
        return;
      }
      gateway = context;
    }
    const auth: ContextAuth | undefined = gateway
      ? { token: "", clientId: JSON.stringify([identity.user ?? null, header(req, CONTEXT_HEADER) ?? null]), scopes: [], extra: { gateway } }
      : undefined;
    await serveModern(Object.assign(req, auth ? { auth } : {}), res, body);
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size, contexts: contexts.size }));
      return;
    }
    if (listen.oidc && req.method === "GET" && (path === metadataPath || path === "/.well-known/oauth-protected-resource")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resource: resourceUrl(req),
          authorization_servers: [listen.oidc.issuer],
          bearer_methods_supported: ["header"],
        }),
      );
      return;
    }
    if (llm && (await llm(req, res))) return;
    if (path !== listen.path || (upstreams.length === 0 && config.llm)) {
      jsonRpcError(res, 404, "Not found");
      return;
    }
    const identity = await authenticate(req.headers.authorization);
    if (!identity) {
      jsonRpcError(res, 401, listen.oidc ? "Missing or invalid Bearer token" : "Missing or invalid Bearer API key", challenge(req));
      return;
    }

    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await readJson(req);
      } catch (err) {
        jsonRpcError(res, 400, err instanceof Error ? err.message : "Bad request");
        return;
      }
    }

    const header = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        jsonRpcError(res, 404, "Session not found");
        return;
      }
      // A session id is not a credential: another user's token does not continue it.
      if (session.user !== undefined && session.user !== identity.user) {
        jsonRpcError(res, 403, "This session belongs to another user");
        return;
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }
    // A 2026-07-28 request carries the per-request envelope; everything else is 2025-era
    if (!(await isLegacyRequest(await toWebRequest(req, body), body))) {
      await handleModern(req, res, body, identity);
      return;
    }
    if (req.method === "POST" && isInitializeRequest(body)) {
      await openSession(req, res, body, identity);
      return;
    }
    jsonRpcError(res, 400, "Bad request: no valid session; start with an initialize request");
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      // 503 when the directory cannot be reached (listen.ldap.onError: deny)
      const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 500;
      if (!res.headersSent) jsonRpcError(res, status, err instanceof Error ? err.message : "Internal error");
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : listen.port;
  const host = listen.host.includes(":") ? `[${listen.host}]` : listen.host;

  return {
    url: `http://${host}:${port}${listen.path}`,
    ...(config.llm ? { llmUrl: `http://${host}:${port}${config.llm.path}` } : {}),
    sessionCount: () => sessions.size,
    contextCount: () => contexts.size,
    async close() {
      clearInterval(sweeper);
      await modern.close();
      for (const context of contexts.values()) context.gateway.dispose();
      contexts.clear();
      stateless?.dispose();
      await Promise.allSettled([...sessions.values()].map((session) => session.transport.close()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
