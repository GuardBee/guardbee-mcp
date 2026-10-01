import http from "http";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuditLogger } from "./audit/logger.js";
import type { GatewayConfig, ListenConfig } from "./gateway/config.js";
import type { Gateway } from "./gateway/gateway.js";
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
}

const digest = (value: string) => createHash("sha256").update(value).digest();

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
): Promise<HttpGateway> {
  const sessions = new Map<string, Session>();
  const keyDigests = listen.apiKeys.map(digest);

  const authorized = (req: http.IncomingMessage): boolean => {
    if (keyDigests.length === 0) return true;
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    if (!match?.[1]) return false;
    const presented = digest(match[1].trim());
    // Compare fixed-length digests in constant time; check every key so timing does not reveal which one matched.
    return keyDigests.reduce((ok, key) => timingSafeEqual(key, presented) || ok, false);
  };

  const openSession = async (req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> => {
    if (sessions.size >= listen.maxSessions) {
      jsonRpcError(res, 503, `Too many sessions (listen.maxSessions=${listen.maxSessions})`);
      return;
    }
    const sessionId = randomUUID();
    const { gateway, server } = createGatewayServer(upstreams, config, audit, { sessionId });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, gateway });
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
    if (path !== listen.path) {
      jsonRpcError(res, 404, "Not found");
      return;
    }
    if (!authorized(req)) {
      jsonRpcError(res, 401, "Missing or invalid Bearer API key", { "www-authenticate": "Bearer" });
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
      await session.transport.handleRequest(req, res, body);
      return;
    }
    if (req.method === "POST" && isInitializeRequest(body)) {
      await openSession(req, res, body);
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
