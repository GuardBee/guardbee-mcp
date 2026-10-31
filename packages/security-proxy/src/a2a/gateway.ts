import { lookup } from "node:dns/promises";
import type http from "node:http";
import { isIP } from "node:net";
import { classifyAddress, hostAllowed, maskPiiInValue, normalizeHost, scanForPromptInjection, scanToolResult } from "@guardbee/guard-core";
import type { AuditLogger } from "../audit/logger.js";
import type { Authenticate } from "../auth.js";
import type { AuditEvent } from "../types.js";

/**
 * A2A (Agent2Agent) through the gateway: an agent calls another agent at
 * <path>/<name> instead of at its own URL, and the gateway applies the same
 * controls it applies to MCP:
 *
 * - the calling agent must authenticate (listen.apiKeys / listen.oidc) and
 *   the target must be a configured agent: unknown agents are refused;
 * - messages to an agent are checked for prompt injection and have personal
 *   data masked; tasks, artifacts and status messages coming back are
 *   checked for indirect injection (block or warn);
 * - push-notification webhooks (where the remote agent will POST) may not
 *   point at private, loopback or cloud-metadata addresses (SSRF);
 * - every call is an audit event, so it reaches the SIEM and OTel exports.
 *
 * JSON-RPC binding, A2A 1.0 (SendMessage, SendStreamingMessage, GetTask, …)
 * and 0.3 (message/send, message/stream, tasks/get, …). The agent card is
 * served rewritten so clients that discover the agent through the gateway
 * keep talking to the gateway.
 */

export interface A2aAgent {
  /** The agent's JSON-RPC endpoint. */
  url: string;
  /** Its agent card; default <origin of url>/.well-known/agent-card.json. */
  cardUrl?: string;
  /** Credentials the gateway presents to this agent (never the caller's). */
  headers?: Record<string, string>;
  /** Only callers in these groups (empty: any authenticated caller). */
  allowGroups?: string[];
}

export interface A2aConfig {
  /** Where agents are served: <path>/<name>. */
  path: string;
  agents: Record<string, A2aAgent>;
  injection: "block" | "warn";
  /** Mask personal data in messages sent to agents. */
  maskRequests: boolean;
  /** Mask personal data in what agents send back. */
  maskResponses: boolean;
  /** Push-notification webhook hosts allowed even when private (an internal receiver). */
  pushAllowHosts: string[];
}

export interface A2aHandlerOptions {
  a2a: A2aConfig;
  audit: AuditLogger;
  authenticate: Authenticate;
  fetchImpl?: typeof fetch;
  resolve?: (host: string) => Promise<{ address: string }[]>;
  /** This gateway's public base URL, for rewritten agent cards; default from the request. */
  publicUrl?: string;
}

export type A2aHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;

const CANONICAL: Record<string, string> = {
  "message/send": "SendMessage",
  "message/stream": "SendStreamingMessage",
  "tasks/get": "GetTask",
  "tasks/list": "ListTasks",
  "tasks/cancel": "CancelTask",
  "tasks/resubscribe": "SubscribeToTask",
  "tasks/pushNotificationConfig/set": "CreateTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/get": "GetTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/list": "ListTaskPushNotificationConfigs",
  "tasks/pushNotificationConfig/delete": "DeleteTaskPushNotificationConfig",
  "agent/getAuthenticatedExtendedCard": "GetExtendedAgentCard",
};
const KNOWN = new Set([...Object.values(CANONICAL)]);
const STREAMING = new Set(["SendStreamingMessage", "SubscribeToTask"]);

type Json = Record<string, unknown>;

/** Every `parts` array in a value: message parts, artifact parts, status-message parts, history. */
function partsIn(value: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(value)) for (const item of value) partsIn(item, out);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Json)) {
      if (key === "parts" && Array.isArray(item)) out.push(...item.filter((p): p is Json => !!p && typeof p === "object"));
      else partsIn(item, out);
    }
  }
  return out;
}

/** The text an agent reads in a value: text parts and structured data parts. */
function textOf(value: unknown): string[] {
  const out: string[] = [];
  for (const part of partsIn(value)) {
    if (typeof part["text"] === "string") out.push(part["text"]);
    if (part["data"] !== undefined) out.push(JSON.stringify(part["data"]));
  }
  return out;
}

/** Mask personal data in parts' text and data, in place; returns the categories found. */
function maskParts(value: unknown): Record<string, number> {
  const hits: Record<string, number> = {};
  const replace = (name: string) => {
    hits[name] = (hits[name] ?? 0) + 1;
    return `[${name}]`;
  };
  for (const part of partsIn(value)) {
    if (typeof part["text"] === "string") part["text"] = maskPiiInValue(part["text"], replace) as string;
    if (part["data"] !== undefined) part["data"] = maskPiiInValue(part["data"], replace);
  }
  return hits;
}

/**
 * Push-notification webhook URLs in a request's params: any `url` under a
 * push-notification config (SendMessage's configuration, 0.3's `pushNotificationConfig`),
 * and the top-level `url` of CreateTaskPushNotificationConfig (1.0).
 */
function webhookUrls(method: string, params: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, inPush: boolean): void => {
    if (Array.isArray(value)) value.forEach((v) => walk(v, inPush));
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value as Json)) {
        const push = inPush || /push/i.test(key) || key === "config";
        if (push && key === "url" && typeof item === "string") out.push(item);
        else walk(item, push);
      }
    }
  };
  walk(params, method === "CreateTaskPushNotificationConfig");
  return out;
}

class Refused extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
    readonly ruleId?: string,
  ) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage, max = 4 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Refused(413, -32600, "request body too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createA2aHandler(options: A2aHandlerOptions): A2aHandler {
  const { a2a, audit } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolve = options.resolve ?? ((host: string) => lookup(host, { all: true }));
  const base = a2a.path.replace(/\/$/, "");
  const log = (event: Omit<AuditEvent, "ts">) => audit.log({ ts: new Date().toISOString(), ...event });

  const publicBase = (req: http.IncomingMessage) => {
    if (options.publicUrl) return options.publicUrl.replace(/\/$/, "");
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
    return `${proto}://${req.headers.host ?? "localhost"}`;
  };

  /** A webhook the remote agent will call must not reach into the private network or cloud metadata. */
  const checkWebhook = async (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Refused(400, -32602, `push notification url is not a URL: ${url}`, "a2a:push-url");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Refused(400, -32602, "push notification url must be http(s)", "a2a:push-url");
    const host = normalizeHost(parsed.hostname);
    const addresses = isIP(host) ? [host] : (await resolve(host).catch(() => [])).map((a) => a.address);
    if (!addresses.length) throw new Refused(400, -32602, `push notification host ${host} does not resolve`, "a2a:push-url");
    const allowed = hostAllowed(host, a2a.pushAllowHosts);
    for (const address of addresses) {
      const kind = classifyAddress(address);
      // Metadata, link-local, unspecified and reserved: never, even when allowed
      if (kind === "link-local" || kind === "unspecified" || kind === "reserved") throw new Refused(403, -32001, `push notification url ${host} resolves to ${address} (${kind}): refused`, "a2a:push-ssrf");
      if ((kind === "private" || kind === "loopback") && !allowed) {
        throw new Refused(403, -32001, `push notification url ${host} resolves to ${address} (${kind}): refused (add it to a2a.pushAllowHosts if it is your own receiver)`, "a2a:push-ssrf");
      }
    }
  };

  const upstreamHeaders = (agent: A2aAgent, req: http.IncomingMessage): Record<string, string> => {
    const headers: Record<string, string> = { "content-type": "application/json", accept: String(req.headers["accept"] ?? "application/json, text/event-stream") };
    for (const name of ["a2a-version", "a2a-extensions"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    // The caller's own Authorization stays here: the agent gets the gateway's credentials for it
    return { ...headers, ...(agent.headers ?? {}) };
  };

  /** Indirect injection in what an agent sends back: refuses (block) or records (warn). */
  const inspectResult = (name: string, method: string, user: string | undefined, result: unknown): void => {
    const texts = textOf(result);
    if (!texts.length) return;
    const scan = scanToolResult(texts, a2a.injection);
    if (scan.action === "allow") return;
    const event = { tool: `a2a.${method}`, upstream: name, server: name, ...(user ? { user } : {}), reason: scan.reason, ruleId: "a2a:result-injection" } as const;
    if (scan.action === "block") {
      log({ type: "blocked", ...event });
      throw new Refused(200, -32001, `Blocked by GuardBee: ${scan.reason}`, "a2a:result-injection");
    }
    log({ type: "warn", ...event });
  };

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://gateway");
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return false;
    const rest = url.pathname.slice(base.length).replace(/^\//, "");
    const [name, ...tail] = rest.split("/").filter(Boolean);
    const agent = name ? a2a.agents[name] : undefined;
    let id: unknown = null;
    try {
      const isCard = req.method === "GET" && tail.join("/") === ".well-known/agent-card.json";
      // The calling agent authenticates first; only the card of a known agent is public (discovery)
      const identity = isCard ? null : await options.authenticate(req.headers.authorization);
      if (!isCard && !identity) throw new Refused(401, -32001, "Authentication required: present the gateway API key or an OIDC access token", "a2a:unauthenticated");
      if (!name || !agent) {
        throw new Refused(404, -32001, `Unknown agent${name ? `: ${name}` : ""}${identity ? `. Agents behind this gateway: ${Object.keys(a2a.agents).join(", ") || "none"}` : ""}`, "a2a:unknown-agent");
      }

      // Discovery: the agent's card, pointing back at the gateway
      if (isCard) {
        const cardUrl = agent.cardUrl ?? new URL("/.well-known/agent-card.json", agent.url).toString();
        const response = await fetchImpl(cardUrl, { headers: { accept: "application/json", ...(agent.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Refused(502, -32603, `agent card of ${name}: HTTP ${response.status}`);
        const card = (await response.json()) as Json;
        const here = `${publicBase(req)}${base}/${name}`;
        if (typeof card["url"] === "string") card["url"] = here;
        for (const key of ["supportedInterfaces", "additionalInterfaces"]) {
          const list = card[key];
          if (Array.isArray(list)) card[key] = list.filter((i: Json) => !i["protocolBinding"] || /jsonrpc/i.test(String(i["protocolBinding"] ?? i["transport"] ?? ""))).map((i: Json) => ({ ...i, url: here }));
        }
        if (typeof card["preferredTransport"] === "string") card["preferredTransport"] = "JSONRPC";
        // Callers authenticate to the gateway, not to the agent
        card["securitySchemes"] = { guardbee: { httpAuthSecurityScheme: { scheme: "bearer", description: "GuardBee gateway API key or OIDC access token" } } };
        card["securityRequirements"] = [{ schemes: { guardbee: { list: [] } } }];
        card["security"] = [{ guardbee: [] }];
        // A signature over the original card does not hold for the rewritten one
        delete card["signatures"];
        send(res, 200, card, { "cache-control": "no-store" });
        return true;
      }
      if (req.method !== "POST" || tail.length) throw new Refused(405, -32600, "A2A JSON-RPC: POST to the agent's URL");

      // Allowed to reach this agent
      if (!identity) throw new Refused(401, -32001, "Authentication required", "a2a:unauthenticated");
      if (agent.allowGroups?.length && !identity.groups.some((g) => agent.allowGroups!.includes(g))) {
        throw new Refused(403, -32001, `Not allowed to reach agent ${name}`, "a2a:forbidden");
      }
      const user = identity.user;

      let request: Json;
      try {
        request = JSON.parse(await readBody(req)) as Json;
      } catch (err) {
        if (err instanceof Refused) throw err;
        throw new Refused(400, -32700, "Parse error");
      }
      id = request["id"] ?? null;
      const method = CANONICAL[String(request["method"])] ?? String(request["method"]);
      if (!KNOWN.has(method)) throw new Refused(200, -32601, `Method not found: ${String(request["method"])}`);
      const params = request["params"];

      // Outbound: injection in the message, webhooks, then masking
      if (method === "SendMessage" || method === "SendStreamingMessage") {
        const texts = textOf(params);
        const scan = scanForPromptInjection(texts, a2a.injection);
        if (scan.action === "block") throw new Refused(200, -32001, `Blocked by GuardBee: ${scan.reason}`, "a2a:message-injection");
        if (scan.action === "warn") log({ type: "warn", tool: `a2a.${method}`, upstream: name, server: name, ...(user ? { user } : {}), reason: scan.reason, ruleId: "a2a:message-injection" });
      }
      for (const webhook of webhookUrls(method, params)) await checkWebhook(webhook);
      const piiHits = a2a.maskRequests ? maskParts(params) : {};
      log({ type: "tool_call", tool: `a2a.${method}`, upstream: name, server: name, ...(user ? { user } : {}), input: params, ...(Object.keys(piiHits).length ? { piiHits } : {}) });

      const upstream = await fetchImpl(agent.url, {
        method: "POST",
        headers: upstreamHeaders(agent, req),
        body: JSON.stringify({ ...request, params }),
        signal: AbortSignal.timeout(STREAMING.has(method) ? 600_000 : 120_000),
      });
      const type = upstream.headers.get("content-type") ?? "";

      // Streaming: pass events through one by one, each checked before it is forwarded
      if (type.includes("text/event-stream") && upstream.body) {
        res.writeHead(upstream.status, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut: number;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
            let event: Json | undefined;
            try {
              event = data ? (JSON.parse(data) as Json) : undefined;
            } catch {
              event = undefined;
            }
            if (event && "result" in event) {
              try {
                inspectResult(name, method, user, event["result"]);
                if (a2a.maskResponses) maskParts(event["result"]);
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32001, message: reason } })}\n\n`);
                await reader.cancel().catch(() => {});
                res.end();
                return true;
              }
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            } else {
              res.write(`${raw}\n\n`);
            }
          }
        }
        res.end();
        log({ type: "tool_response", tool: `a2a.${method}`, upstream: name, server: name, ...(user ? { user } : {}) });
        return true;
      }

      const answer = (await upstream.json().catch(() => null)) as Json | null;
      if (!answer) throw new Refused(502, -32603, `agent ${name} answered HTTP ${upstream.status} without JSON`);
      if ("result" in answer) {
        inspectResult(name, method, user, answer["result"]);
        const hits = a2a.maskResponses ? maskParts(answer["result"]) : {};
        log({ type: "tool_response", tool: `a2a.${method}`, upstream: name, server: name, ...(user ? { user } : {}), output: answer["result"], ...(Object.keys(hits).length ? { piiHits: hits } : {}) });
      }
      send(res, upstream.status, answer);
      return true;
    } catch (err) {
      const refused = err instanceof Refused ? err : new Refused(502, -32603, `A2A gateway error: ${err instanceof Error ? err.message : String(err)}`);
      if (refused.ruleId && refused.ruleId !== "a2a:result-injection") {
        log({ type: "blocked", tool: "a2a", ...(name ? { upstream: name, server: name } : {}), reason: refused.message, ruleId: refused.ruleId });
      }
      if (!res.headersSent) send(res, refused.status, { jsonrpc: "2.0", id, error: { code: refused.code, message: refused.message } }, refused.status === 401 ? { "www-authenticate": "Bearer" } : {});
      else res.end();
      return true;
    }
  };
}
