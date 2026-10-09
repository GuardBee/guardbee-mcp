import http from "http";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuditLogger } from "./audit/logger.js";
import { createAuthenticator, type Authenticate, type Identity } from "./auth.js";
import type { GatewayConfig, ListenConfig } from "./gateway/config.js";
import type { Gateway } from "./gateway/gateway.js";
import { QuotaStore } from "./gateway/quota.js";
import type { Upstream } from "./gateway/upstream.js";
import { createGatewayServer } from "./proxy.js";

type HttpListen = Extract<ListenConfig, { transport: "http" }>;

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpGateway {
  /** Base URL of the MCP endpoint, e.g. http://127.0.0.1:8787/mcp */
  url: string;
  sessionCount(): number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  gateway: Gateway;
  /** Who opened it; with OIDC only that user may continue it. */
  user?: string;
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
  options: { authenticate?: Authenticate } = {},
): Promise<HttpGateway> {
  const sessions = new Map<string, Session>();
  // One set of quota counters for every session of this process
  const quotas = new QuotaStore();
  const authenticate = options.authenticate ?? createAuthenticator(listen.apiKeys, listen.oidc);
  const metadataPath = `/.well-known/oauth-protected-resource${listen.path}`;

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
    if (sessions.size >= listen.maxSessions) {
      jsonRpcError(res, 503, `Too many sessions (listen.maxSessions=${listen.maxSessions})`);
      return;
    }
    const sessionId = randomUUID();
    const { gateway, server } = createGatewayServer(upstreams, config, audit, {
      sessionId,
      quotas,
      ...(identity.user ? { identity: { user: identity.user, groups: identity.groups } } : {}),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessioninitialized: (id) => {
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

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
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
    if (path !== listen.path) {
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
    if (req.method === "POST" && isInitializeRequest(body)) {
      await openSession(req, res, body, identity);
      return;
    }
    jsonRpcError(res, 400, "Bad request: no valid session; start with an initialize request");
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) jsonRpcError(res, 500, err instanceof Error ? err.message : "Internal error");
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
    sessionCount: () => sessions.size,
    async close() {
      await Promise.allSettled([...sessions.values()].map((session) => session.transport.close()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
