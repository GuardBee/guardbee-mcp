import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

/**
 * Network egress guard (SSRF): which addresses an outbound connection may
 * reach. The check runs in the socket's DNS lookup, so the address that was
 * checked is the address that is connected to: a DNS answer that changes
 * between a check and the connect (rebinding) cannot slip through.
 */

/**
 * - `public`: anything not listed below
 * - `loopback`: 127.0.0.0/8, ::1
 * - `private`: RFC 1918, CGNAT 100.64.0.0/10, benchmarking 198.18.0.0/15, unique-local fc00::/7
 * - `link-local`: 169.254.0.0/16 (cloud metadata lives here), fe80::/10, and the AWS IPv6 metadata address
 * - `unspecified`: 0.0.0.0/8, :: (reaches the local host on most systems)
 * - `reserved`: multicast, broadcast, 240.0.0.0/4, documentation ranges
 */
export type AddressClass = "public" | "loopback" | "private" | "link-local" | "unspecified" | "reserved";

function ipv4Class(ip: string): AddressClass {
  const [a, b, c] = ip.split(".").map(Number) as [number, number, number, number];
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) {
    return "private";
  }
  if (a >= 224) return "reserved"; // multicast, 240/4, broadcast
  if ((a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return "reserved";
  return "public";
}

/** The eight 16-bit groups of an IPv6 address (with an embedded dotted IPv4 tail, if any). */
function ipv6Groups(ip: string): number[] {
  let text = ip.toLowerCase().split("%")[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split(".").map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::") as [string, string | undefined];
  const parse = (part: string) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

export function classifyAddress(ip: string): AddressClass {
  const family = isIP(ip.split("%")[0]!);
  if (family === 4) return ipv4Class(ip);
  if (family !== 6) throw new Error(`not an IP address: ${ip}`);
  const g = ipv6Groups(ip);
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return "unspecified";
  if (zeroTo(7) && g[7] === 1) return "loopback";
  // An IPv4 address in IPv6 clothing is judged as that IPv4 address:
  // mapped ::ffff:a.b.c.d, compatible ::a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16
  if (zeroTo(5) && g[5] === 0xffff) return ipv4Class(v4From(g[6]!, g[7]!));
  if (zeroTo(6)) return ipv4Class(v4From(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return ipv4Class(v4From(g[6]!, g[7]!));
  if (g[0] === 0x2002) return ipv4Class(v4From(g[1]!, g[2]!));
  if ((g[0]! & 0xffc0) === 0xfe80) return "link-local";
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g.slice(2, 7).every((x) => x === 0) && g[7] === 0x254) return "link-local"; // AWS IMDS over IPv6
  if ((g[0]! & 0xfe00) === 0xfc00) return "private";
  if ((g[0]! & 0xff00) === 0xff00 || (g[0] === 0x2001 && g[1] === 0x0db8)) return "reserved";
  return "public";
}

export interface EgressPolicy {
  /**
   * `open`: any host. `allowlist`: only hosts matching `allowHosts`.
   * `none`: no connection at all.
   */
  mode: "open" | "allowlist" | "none";
  /** Host names or globs (`*.example.com` matches subdomains, not example.com itself); IP literals match exactly. */
  allowHosts?: string[];
  /**
   * Refuse loopback and private addresses. Link-local (cloud metadata),
   * unspecified and reserved addresses are always refused.
   */
  blockPrivate: boolean;
}

export type EgressRule = "network:none" | "network:host" | "network:private" | "network:metadata" | "network:reserved";

/** A connection the policy refused: the destination is named, nothing of the request is kept. */
export class EgressBlockedError extends Error {
  readonly code = "EGRESS_BLOCKED";
  constructor(
    readonly rule: EgressRule,
    readonly host: string,
    readonly address: string | undefined,
    reason: string,
  ) {
    super(reason);
    this.name = "EgressBlockedError";
  }
}

function globToRegExp(glob: string): RegExp {
  const body = glob.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+(?:\\.[^.]+)*");
  return new RegExp(`^${body}$`);
}

/** Lower-cased, without IPv6 brackets or a trailing dot. */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const name = normalizeHost(host);
  return patterns.some((pattern) => {
    const p = normalizeHost(pattern);
    return p.includes("*") ? globToRegExp(p).test(name) : p === name;
  });
}

/** Why `host` may not be contacted at all, before any lookup; undefined when it may. */
export function checkHost(host: string, policy: EgressPolicy): EgressBlockedError | undefined {
  const name = normalizeHost(host);
  if (policy.mode === "none") return new EgressBlockedError("network:none", name, undefined, `network access is off (mode: none); refused ${name}`);
  if (policy.mode === "allowlist" && !hostAllowed(name, policy.allowHosts ?? [])) {
    return new EgressBlockedError("network:host", name, undefined, `${name} is not in allowHosts`);
  }
  return undefined;
}

/** Why `address` (resolved from `host`) may not be connected to; undefined when it may. */
export function checkAddress(host: string, address: string, policy: EgressPolicy): EgressBlockedError | undefined {
  const name = normalizeHost(host);
  const kind = classifyAddress(address);
  const via = name === address ? address : `${name} (${address})`;
  if (kind === "link-local") return new EgressBlockedError("network:metadata", name, address, `${via} is a link-local address, where cloud metadata services answer`);
  if (kind === "unspecified" || kind === "reserved") return new EgressBlockedError("network:reserved", name, address, `${via} is a ${kind} address`);
  if ((kind === "loopback" || kind === "private") && policy.blockPrivate) {
    return new EgressBlockedError("network:private", name, address, `${via} is a ${kind} address (blockPrivate)`);
  }
  return undefined;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

const systemResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

export interface GuardOptions {
  /** Called for every refused connection, before the request fails. */
  onBlocked?: (error: EgressBlockedError) => void;
  /** DNS resolution; the system resolver by default. */
  resolve?: Resolver;
}

/**
 * A `lookup` for `net`/`http` sockets that resolves, checks every address,
 * and hands the socket only checked addresses. Any refused address fails the
 * lookup: a name that answers with both a public and a private address is
 * treated as a rebinding attempt.
 */
export function guardedLookup(policy: EgressPolicy, options: GuardOptions = {}): LookupFunction {
  const resolve = options.resolve ?? systemResolver;
  return (hostname, lookupOptions, callback) => {
    const fail = (error: EgressBlockedError) => {
      options.onBlocked?.(error);
      callback(error, "", 0);
    };
    const denied = checkHost(hostname, policy);
    if (denied) return fail(denied);
    resolve(hostname).then(
      (answers) => {
        const family = lookupOptions.family === 4 || lookupOptions.family === "IPv4" ? 4 : lookupOptions.family === 6 || lookupOptions.family === "IPv6" ? 6 : 0;
        const usable = family ? answers.filter((a) => a.family === family) : answers;
        for (const answer of usable) {
          const refused = checkAddress(hostname, answer.address, policy);
          if (refused) return fail(refused);
        }
        if (usable.length === 0) return callback(Object.assign(new Error(`${hostname}: no address`), { code: "ENOTFOUND" }), "", 0);
        if (lookupOptions.all) (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, usable);
        else callback(null, usable[0]!.address, usable[0]!.family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };
}

function toWebResponse(res: IncomingMessage): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const status = res.statusCode ?? 502;
  const empty = status === 204 || status === 205 || status === 304;
  if (empty) res.resume();
  return new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, statusText: res.statusMessage ?? "", headers });
}

async function bodyBytes(body: RequestInit["body"]): Promise<Uint8Array | string | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * A `fetch` whose every connection passes the egress policy. Redirects are
 * never followed: a 3xx comes back as it is, so the caller decides and its
 * next request is checked again (the MCP SDK's transports follow same-origin
 * redirects this way).
 */
export function guardedFetch(policy: EgressPolicy, options: GuardOptions = {}): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const lookup = guardedLookup(policy, options);
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`guardedFetch: unsupported protocol ${url.protocol}`);
    const host = normalizeHost(url.hostname);
    // A literal IP never reaches the lookup: check it here
    if (isIP(host)) {
      const refused = checkHost(host, policy) ?? checkAddress(host, host, policy);
      if (refused) {
        options.onBlocked?.(refused);
        throw refused;
      }
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const body = await bodyBytes(init.body ?? (input instanceof Request && input.body ? await input.arrayBuffer() : undefined));
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise<Response>((resolve, reject) => {
      const req = send(url, {
        method: init.method ?? (input instanceof Request ? input.method : "GET"),
        headers: Object.fromEntries(headers),
        lookup,
        ...(init.signal ? { signal: init.signal } : {}),
      });
      req.on("response", (res) => resolve(toWebResponse(res)));
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  };
}
