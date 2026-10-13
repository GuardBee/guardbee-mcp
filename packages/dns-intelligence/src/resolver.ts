import * as dns from "dns/promises";

/** The subset of `dns/promises` the checks use; tests inject a fake. */
export interface DnsResolver {
  resolve4(name: string, options: { ttl: true }): Promise<Array<{ address: string; ttl: number }>>;
  resolve6(name: string, options: { ttl: true }): Promise<Array<{ address: string; ttl: number }>>;
  resolveMx(name: string): Promise<Array<{ priority: number; exchange: string }>>;
  resolveNs(name: string): Promise<string[]>;
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolveSoa(name: string): Promise<{
    nsname: string;
    hostmaster: string;
    serial: number;
    refresh: number;
    retry: number;
    expire: number;
    minttl: number;
  }>;
}

export const systemResolver: DnsResolver = dns;

/**
 * Outcome of one query. "nxdomain" (the name does not exist) and "nodata"
 * (it exists but has no records of that type) are answers; "error" is a
 * failed query (SERVFAIL, timeout, refused) whose answer is unknown.
 */
export type Lookup<T> =
  | { status: "ok"; value: T }
  | { status: "nxdomain" | "nodata" }
  | { status: "error"; code: string };

export async function lookup<T>(query: () => Promise<T>): Promise<Lookup<T>> {
  try {
    const value = await query();
    if (Array.isArray(value) && value.length === 0) return { status: "nodata" };
    return { status: "ok", value };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "UNKNOWN";
    if (code === "ENOTFOUND") return { status: "nxdomain" };
    if (code === "ENODATA") return { status: "nodata" };
    return { status: "error", code };
  }
}

/** The value of a successful lookup, or null for any other outcome. */
export function valueOf<T>(r: Lookup<T>): T | null {
  return r.status === "ok" ? r.value : null;
}

/**
 * "example.com", "Example.COM.", "https://example.com/path" → "example.com".
 * Throws on input that is not a hostname.
 */
export function normalizeDomain(input: string): string {
  let host = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) host = new URL(host).hostname;
  host = host.toLowerCase().replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) {
    throw new Error(`Not a domain name: ${JSON.stringify(input)}`);
  }
  return host;
}
