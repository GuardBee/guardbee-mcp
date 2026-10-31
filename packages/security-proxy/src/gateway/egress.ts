import fs from "fs";
import http from "http";
import net from "net";
import { EgressBlockedError, checkAddress, checkHost, guardedLookup, normalizeHost, type EgressPolicy, type GuardOptions } from "@guardbee/guard-core";

/**
 * The only way out of a sandbox with `network: allowlist`: an HTTP proxy in
 * the gateway process (CONNECT for TLS, absolute-form requests for plain
 * HTTP) that connects to a host only when it matches `allowHosts`. The
 * address is checked when it is resolved, on the connection itself, so a
 * name that resolves to a private or metadata address is refused (DNS
 * rebinding included). The sandbox has no other network: the runtime lets it
 * reach this proxy and nothing else.
 */
export interface EgressProxy {
  /** TCP port on 127.0.0.1 (listen: tcp). */
  port?: number;
  /** Unix socket path (listen: socket). */
  socket?: string;
  close(): Promise<void>;
}

export interface EgressProxyOptions {
  /** Where the proxy listens: an ephemeral port on 127.0.0.1, or a unix socket at this path. */
  listen: { tcp: true } | { socket: string };
  onBlocked?: (error: EgressBlockedError) => void;
  resolve?: GuardOptions["resolve"];
}

/** `host:port` of a CONNECT request (IPv6 in brackets). */
function splitAuthority(authority: string): { host: string; port: number } | undefined {
  const m = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(authority);
  if (!m) return undefined;
  const port = Number(m[3]);
  return port > 0 && port < 65536 ? { host: (m[1] ?? m[2])!, port } : undefined;
}

export async function startEgressProxy(policy: EgressPolicy, options: EgressProxyOptions): Promise<EgressProxy> {
  const notify = (error: EgressBlockedError) => options.onBlocked?.(error);
  const lookup = guardedLookup(policy, { onBlocked: notify, ...(options.resolve ? { resolve: options.resolve } : {}) });

  /** Refusal before any connection: the host is not allowed, or is an IP literal (no lookup runs for those) in a blocked range. */
  const refused = (host: string): EgressBlockedError | undefined => {
    const name = normalizeHost(host);
    const error = checkHost(name, policy) ?? (net.isIP(name) ? checkAddress(name, name, policy) : undefined);
    if (error) notify(error);
    return error;
  };

  /** CONNECT tunnels: upgraded sockets the HTTP server no longer tracks. */
  const tunnels = new Set<net.Socket>();

  const server = http.createServer((req, res) => {
    // Plain HTTP through a proxy: the request line carries the absolute URL
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end("absolute URL required\n");
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end("only http:// is proxied this way; use CONNECT for https\n");
      return;
    }
    const denied = refused(target.hostname);
    if (denied) {
      res.writeHead(403, { "content-type": "text/plain" }).end(`${denied.message}\n`);
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = http.request(
      { host: target.hostname.replace(/^\[|\]$/g, ""), port: target.port || 80, path: `${target.pathname}${target.search}`, method: req.method, headers, lookup },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      if (res.headersSent) res.destroy();
      else res.writeHead(err instanceof EgressBlockedError ? 403 : 502, { "content-type": "text/plain" }).end(`${err.message}\n`);
    });
    req.pipe(upstream);
  });

  server.on("connect", (req, client: net.Socket, head: Buffer) => {
    const target = splitAuthority(req.url ?? "");
    if (!target) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const denied = refused(target.host);
    if (denied) {
      client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${denied.message}\n`);
      return;
    }
    const upstream = net.connect({ host: target.host, port: target.port, lookup });
    let connected = false;
    tunnels.add(client).add(upstream);
    const forget = () => tunnels.delete(client) && tunnels.delete(upstream);
    upstream.once("connect", () => {
      connected = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", (err) => {
      if (connected || client.destroyed) client.destroy();
      else client.end(`HTTP/1.1 ${err instanceof EgressBlockedError ? "403 Forbidden" : "502 Bad Gateway"}\r\ncontent-type: text/plain\r\n\r\n${err.message}\n`);
    });
    upstream.on("close", () => (client.destroy(), forget()));
    client.on("error", () => upstream.destroy());
    client.on("close", () => (upstream.destroy(), forget()));
  });

  const shutdown = (done: () => void) => {
    for (const socket of tunnels) socket.destroy();
    server.closeAllConnections();
    server.close(() => done());
  };

  if ("socket" in options.listen) {
    const socket = options.listen.socket;
    fs.rmSync(socket, { force: true });
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, () => resolve()));
    fs.chmodSync(socket, 0o600);
    return {
      socket,
      close: () => new Promise((resolve) => shutdown(() => (fs.rmSync(socket, { force: true }), resolve()))),
    };
  }
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", () => resolve()));
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => new Promise((resolve) => shutdown(resolve)),
  };
}
