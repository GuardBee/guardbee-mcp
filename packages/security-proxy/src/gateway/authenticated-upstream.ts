import type { HttpUpstreamConfig } from "../types.js";
import { currentCaller } from "./caller-context.js";
import { ConsentRequired, UpstreamAuthError, insufficientScope, scopesFor, tokenSubject, type UpstreamCredentials } from "./upstream-auth.js";
import type { Upstream } from "./upstream.js";

/**
 * An HTTP upstream reached with each caller's own downstream credential
 * (token exchange or per-user OAuth). One MCP connection per user, made on
 * that user's first request; the bearer token is set per HTTP request from
 * the credential source, so a refreshed or stepped-up token applies at once.
 * The caller's inbound token is never in these requests.
 */

export const CONNECT_TOOL = "connect_account";

type Connect = (name: string, server: HttpUpstreamConfig, options: { fetch: (url: string | URL, init?: RequestInit) => Promise<Response>; sampling?: boolean }) => Promise<Upstream>;

interface Pooled {
  upstream: Promise<Upstream>;
  /** The latest request's caller for this user (its token can change between requests). */
  caller: { user: string; token?: string };
  lastUsed: number;
}

const MAX_USERS = 1000;

/** The tool a JSON-RPC body calls, if it is a tools/call. */
function calledTool(body: unknown): string | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const message = JSON.parse(body) as { method?: string; params?: { name?: unknown } } | { method?: string; params?: { name?: unknown } }[];
    const first = Array.isArray(message) ? message[0] : message;
    return first?.method === "tools/call" && typeof first.params?.name === "string" ? first.params.name : undefined;
  } catch {
    return undefined;
  }
}

function withBearer(headers: RequestInit["headers"], token: string): Headers {
  const out = new Headers(headers);
  // Whatever authorization the request carried (none is configured for these upstreams), the credential replaces it
  out.set("authorization", `Bearer ${token}`);
  return out;
}

export function authenticatedUpstream(
  name: string,
  server: HttpUpstreamConfig,
  credentials: UpstreamCredentials,
  connect: Connect,
  options: { sampling?: boolean; policyFetch: (url: string | URL, init?: RequestInit) => Promise<Response> },
): Upstream {
  const pool = new Map<string, Pooled>();
  const toolListeners = new Set<() => void>();

  const callerOf = (): { user: string; token?: string } => {
    const scope = currentCaller();
    if (!scope?.user) throw new UpstreamAuthError(`${name} acts as each user: sign in to the gateway (OIDC) to use it`);
    return { user: scope.user, ...(scope.token ? { token: scope.token } : {}) };
  };

  const clientFor = (caller: { user: string; token?: string }): Promise<Upstream> => {
    let pooled = pool.get(caller.user);
    if (pooled) {
      pooled.caller = caller;
      pooled.lastUsed = Date.now();
      return pooled.upstream;
    }
    const entry: Pooled = { caller, lastUsed: Date.now(), upstream: Promise.resolve(undefined as unknown as Upstream) };
    const authFetch = async (url: string | URL, init: RequestInit = {}): Promise<Response> => {
      const tool = calledTool(init.body);
      let token = await credentials.tokenFor(entry.caller, scopesFor(credentials.auth, tool), tool ? `tools/call ${tool}` : "connect");
      const scope = currentCaller();
      if (scope) scope.upstreamIdentity = tokenSubject(token.accessToken) ?? entry.caller.user;
      let response = await options.policyFetch(url, { ...init, headers: withBearer(init.headers, token.accessToken) });
      const needed = (response.status === 401 || response.status === 403) && insufficientScope(response.headers.get("www-authenticate"));
      if (needed) {
        // Step-up: the upstream says which scope the call needs
        token = await credentials.tokenFor(entry.caller, [...token.scopes, ...needed], `${name} answered insufficient_scope${needed.length ? ` (${needed.join(" ")})` : ""}`);
        response = await options.policyFetch(url, { ...init, headers: withBearer(init.headers, token.accessToken) });
      }
      return response;
    };
    entry.upstream = connect(name, server, { fetch: authFetch, ...(options.sampling !== undefined ? { sampling: options.sampling } : {}) }).then((upstream) => {
      upstream.onToolsChanged?.(() => toolListeners.forEach((l) => l()));
      return upstream;
    });
    entry.upstream.catch(() => pool.delete(caller.user));
    pool.set(caller.user, entry);
    // Bounded: the least recently used connection goes
    if (pool.size > MAX_USERS) {
      const [oldest] = [...pool.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      pool.delete(oldest![0]);
      void oldest![1].upstream.then((u) => u.close()).catch(() => {});
    }
    return entry.upstream;
  };

  /** Run against this caller's connection; a missing consent becomes a link instead of a failure. */
  const withUser = async <T>(work: (upstream: Upstream) => Promise<T>, onConsent: (consent: ConsentRequired) => T): Promise<T> => {
    try {
      return await work(await clientFor(callerOf()));
    } catch (err) {
      if (err instanceof ConsentRequired) return onConsent(err);
      // The connection itself failed on consent (initialize): forget it so the next request retries
      const cause = (err as { cause?: unknown })?.cause;
      if (cause instanceof ConsentRequired) {
        pool.delete(callerOf().user);
        return onConsent(cause);
      }
      throw err;
    }
  };

  const connectTool = (consent: ConsentRequired) => ({
    name: CONNECT_TOOL,
    description: `Connect your ${name} account to this gateway. Returns a link to open in a browser; ${name}'s tools appear once you have approved access (scopes: ${consent.scopes.join(" ") || "default"}).`,
    inputSchema: { type: "object" as const, properties: {} },
    annotations: { readOnlyHint: true },
  });
  const consentResult = (consent: ConsentRequired) => ({
    content: [{ type: "text" as const, text: `Open this link to connect your ${name} account, then try again:\n${consent.url}` }],
    isError: true,
  });

  return {
    name,
    get protocolVersion() {
      return undefined;
    },
    listTools: () => withUser((u) => u.listTools(), (consent) => [connectTool(consent)]),
    callTool: (tool, args, callOptions) =>
      withUser(
        async (u) => (tool === CONNECT_TOOL ? { content: [{ type: "text" as const, text: `Your ${name} account is connected.` }] } : u.callTool(tool, args, callOptions)),
        consentResult,
      ),
    listResources: () => withUser((u) => u.listResources(), () => []),
    readResource: (uri) => withUser((u) => u.readResource(uri), (consent) => { throw consent; }),
    listPrompts: () => withUser((u) => u.listPrompts(), () => []),
    getPrompt: (prompt, args) => withUser((u) => u.getPrompt(prompt, args), (consent) => { throw consent; }),
    onToolsChanged(listener) {
      toolListeners.add(listener);
      return () => toolListeners.delete(listener);
    },
    /** A user finished the consent page: their tool list changes from the connect tool to the real one. */
    notifyConnected() {
      toolListeners.forEach((l) => l());
    },
    async close() {
      const all = [...pool.values()];
      pool.clear();
      await Promise.allSettled(all.map((p) => p.upstream.then((u) => u.close())));
    },
  } as Upstream & { notifyConnected(): void };
}
