import { Client, ProtocolError, ProtocolErrorCode, StreamableHTTPClientTransport, type VersionNegotiationOptions } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  CallToolResult,
  CreateMessageRequest,
  CreateMessageResult,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/client";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyAddress, guardedFetch, normalizeHost, type EgressBlockedError, type EgressPolicy } from "@guardbee/guard-core";
import { authenticatedUpstream } from "./authenticated-upstream.js";
import { startEgressProxy, type EgressProxy } from "./egress.js";
import type { UpstreamCredentials } from "./upstream-auth.js";
import { egressListen, sandboxContext, sandboxLaunch } from "./sandbox.js";
import { isHttpUpstream, type HttpUpstreamConfig, type McpServerConfig, type UpstreamConfig, type UpstreamProtocol } from "../types.js";

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
  /** The MCP revision negotiated with the server, e.g. 2025-11-25 or 2026-07-28. */
  readonly protocolVersion?: string;
  /**
   * Register for the server's tools/list_changed notification. Several
   * sessions share one upstream, so each gets its own listener; the returned
   * function removes it.
   */
  onToolsChanged?(listener: () => void): () => void;
  close(): Promise<void>;
}

/** Wrap a connected MCP client. Resources and prompts are empty when the server does not offer them. */
export function clientUpstream(name: string, client: Client, options: { sampling?: boolean; toolListeners?: Set<() => void> } = {}): Upstream {
  const caps = () => client.getServerCapabilities() ?? {};
  // Calls in flight that can answer sampling, newest last. A 2026-07-28
  // server asks inside its tools/call answer (input_required); the client
  // runs the same handler for it, still within callTool.
  const active: NonNullable<CallOptions["sampling"]>[] = [];
  if (options.sampling) {
    client.setRequestHandler("sampling/createMessage", async (request) => {
      const owners = new Set(active.map((entry) => entry.owner));
      if (owners.size === 0) {
        throw new ProtocolError(ProtocolErrorCode.InvalidRequest, "GuardBee gateway: sampling is only answered while one of this server's tool calls is running");
      }
      if (owners.size > 1) {
        throw new ProtocolError(ProtocolErrorCode.InvalidRequest, "GuardBee gateway: several sessions are calling this server; cannot tell which one asked for sampling");
      }
      return active[active.length - 1]!.handler(request.params);
    });
  }
  // The client keeps one tools/list_changed handler (proxyClient's listChanged): fan out from it.
  const toolListeners = options.toolListeners ?? new Set<() => void>();
  if (!options.toolListeners) {
    client.setNotificationHandler("notifications/tools/list_changed", () => {
      for (const listener of toolListeners) listener();
    });
  }
  const protocolVersion = client.getNegotiatedProtocolVersion();
  return {
    name,
    ...(protocolVersion ? { protocolVersion } : {}),
    // Always ask the server: a cache hint it sets must not hide a changed definition from drift checks
    async listTools() {
      return (await client.listTools(undefined, { cacheMode: "refresh" })).tools;
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
      return caps().resources ? (await client.listResources(undefined, { cacheMode: "refresh" })).resources : [];
    },
    readResource(uri) {
      return client.readResource({ uri }, { cacheMode: "refresh" });
    },
    async listPrompts() {
      return caps().prompts ? (await client.listPrompts(undefined, { cacheMode: "refresh" })).prompts : [];
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

const NEGOTIATION: Record<UpstreamProtocol, VersionNegotiationOptions> = {
  auto: { mode: "auto" },
  "2025-11-25": { mode: "legacy" },
  "2026-07-28": { mode: { pin: "2026-07-28" } },
};

/**
 * Only offer sampling to servers when interceptors.sampling is on: a server
 * may change course when it sees the capability. tools/list_changed comes as
 * a notification from a 2025-11-25 server and over a subscriptions/listen
 * stream the client opens itself on 2026-07-28; both reach `toolListeners`.
 */
function proxyClient(sampling: boolean, protocol: UpstreamProtocol = "auto"): { client: Client; toolListeners: Set<() => void> } {
  const toolListeners = new Set<() => void>();
  const client = new Client(
    { name: "guardbee-proxy-client", version: "1.0.0" },
    {
      capabilities: sampling ? { sampling: {} } : {},
      versionNegotiation: NEGOTIATION[protocol],
      listChanged: {
        tools: {
          autoRefresh: false,
          debounceMs: 0,
          onChanged: () => {
            for (const listener of toolListeners) listener();
          },
        },
      },
    },
  );
  return { client, toolListeners };
}

export interface ConnectOptions {
  sampling?: boolean;
  /** Called for every connection the upstream's network policy refuses (HTTP upstreams). */
  onEgressBlocked?: (error: EgressBlockedError) => void;
  /** HTTP upstreams with upstreams.<name>.auth: where each caller's downstream token comes from. */
  credentials?: UpstreamCredentials;
}

/**
 * The egress policy for an HTTP upstream. Without `blockPrivate`, the
 * configured URL decides: a server on a loopback or private address (or a
 * name that resolves only to such addresses) may stay on the private network;
 * any other may not reach it, through a redirect or a DNS answer that changes.
 */
export async function upstreamEgressPolicy(server: HttpUpstreamConfig, resolve = (host: string) => lookup(host, { all: true })): Promise<EgressPolicy> {
  const network = server.network ?? {};
  const mode = network.mode ?? "open";
  const allowHosts = network.allowHosts ?? [];
  if (network.blockPrivate !== undefined) return { mode, allowHosts, blockPrivate: network.blockPrivate };
  const host = normalizeHost(new URL(server.url).hostname);
  const isPrivate = (address: string) => ["loopback", "private"].includes(classifyAddress(address));
  let onPrivateNetwork: boolean;
  if (isIP(host)) onPrivateNetwork = isPrivate(host);
  else if (host === "localhost" || host.endsWith(".localhost")) onPrivateNetwork = true;
  else {
    const addresses = await resolve(host).catch(() => []);
    onPrivateNetwork = addresses.length > 0 && addresses.every((a) => isPrivate(a.address));
  }
  return { mode, allowHosts, blockPrivate: !onPrivateNetwork };
}

export async function connectHttpUpstream(name: string, server: HttpUpstreamConfig, options: ConnectOptions & { fetch?: (url: string | URL, init?: RequestInit) => Promise<Response> } = {}): Promise<Upstream> {
  const policy = await upstreamEgressPolicy(server);
  const policyFetch = guardedFetch(policy, options.onEgressBlocked ? { onBlocked: options.onEgressBlocked } : {});
  // Each caller's own credential: one connection per user, made on demand
  if (options.credentials) {
    return authenticatedUpstream(name, server, options.credentials, (n, s, o) => connectHttpUpstream(n, s, { ...o, ...(options.onEgressBlocked ? { onEgressBlocked: options.onEgressBlocked } : {}) }), {
      policyFetch,
      ...(options.sampling !== undefined ? { sampling: options.sampling } : {}),
    });
  }
  const { client, toolListeners } = proxyClient(options.sampling ?? false, server.protocol);
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: server.headers ? { headers: server.headers } : undefined,
    fetch: options.fetch ?? policyFetch,
  });
  await client.connect(transport);
  return clientUpstream(name, client, { ...options, toolListeners });
}

export function connectUpstream(name: string, server: UpstreamConfig, options: ConnectOptions = {}): Promise<Upstream> {
  return isHttpUpstream(server) ? connectHttpUpstream(name, server, options) : connectStdioUpstream(name, server, options);
}

/**
 * Probes on the server's own process. The SDK's StdioClientTransport probes on
 * a short-lived second process instead; a container sandbox runs under a fixed
 * name, so a second container would clash with the first.
 */
class InPlaceStdioClientTransport extends StdioClientTransport {}

/** A container sandbox is started once, so it is not probed unless `protocol` asks for it. */
export function stdioProtocol(server: McpServerConfig): UpstreamProtocol {
  const container = server.sandbox?.runtime === "docker" || server.sandbox?.runtime === "podman";
  return server.protocol ?? (container ? "2025-11-25" : "auto");
}

export async function connectStdioUpstream(name: string, server: McpServerConfig, options: ConnectOptions = {}): Promise<Upstream> {
  const { client, toolListeners } = proxyClient(options.sampling ?? false, stdioProtocol(server));
  const ctx = sandboxContext(name);
  // network: allowlist — the sandbox's only way out, started before the server and closed with it
  let egress: EgressProxy | undefined;
  if (server.sandbox && server.sandbox.runtime !== "none" && server.sandbox.network === "allowlist") {
    egress = await startEgressProxy(
      { mode: "allowlist", allowHosts: server.sandbox.allowHosts ?? [], blockPrivate: server.sandbox.blockPrivate ?? true },
      { listen: egressListen(server.sandbox, ctx), ...(options.onEgressBlocked ? { onBlocked: options.onEgressBlocked } : {}) },
    );
  }
  let launch;
  try {
    launch = server.sandbox ? sandboxLaunch(server, server.sandbox, ctx, egress) : undefined;
  } catch (err) {
    await egress?.close();
    throw err;
  }
  const container = server.sandbox?.runtime === "docker" || server.sandbox?.runtime === "podman";
  const transport = new (container ? InPlaceStdioClientTransport : StdioClientTransport)(
    launch ?? {
      command: server.command,
      args: server.args ?? [],
      env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
    },
  );
  try {
    await client.connect(transport);
  } catch (err) {
    await egress?.close();
    throw err;
  }
  const upstream = clientUpstream(name, client, { ...options, toolListeners });
  if (!egress) return upstream;
  const close = upstream.close.bind(upstream);
  upstream.close = async () => {
    await close();
    await egress.close();
  };
  return upstream;
}
