import type { Finding } from "./dns.js";
import { lookup, type DnsResolver } from "./resolver.js";
import { TYPE, decodeMessage, encodeQuery, soaFields, socketTransport, type DnsTransport } from "./wire.js";

export interface NameserverStatus {
  host: string;
  ip?: string;
  /** Answered SOA for the domain with the AA flag. */
  authoritative?: boolean;
  serial?: number;
  /** SOA MNAME (primary) it reports; serials are only comparable between servers sharing one. */
  primary?: string;
  /** "allowed": the server sent zone data to an anonymous AXFR. */
  axfr?: "allowed" | "refused" | "unreachable";
  /** Answers recursive queries for names it does not host. */
  openResolver?: boolean;
  error?: string;
}

export interface NameserverReport {
  servers: NameserverStatus[];
  findings: Finding[];
}

export interface NameserverOptions {
  transport?: DnsTransport;
  timeoutMs?: number;
  /** Name used to test recursion; must not be hosted by the servers. */
  recursionProbe?: string;
}

const RCODE: Record<number, string> = { 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED", 9: "NOTAUTH" };

async function probeServer(domain: string, host: string, r: DnsResolver, o: Required<NameserverOptions>): Promise<NameserverStatus> {
  const status: NameserverStatus = { host };
  const addrs = await lookup(() => r.resolve4(host, { ttl: true }));
  if (addrs.status !== "ok" || addrs.value.length === 0) {
    status.error = addrs.status === "error" ? `cannot resolve (${addrs.code})` : "has no A record";
    return status;
  }
  const ip = addrs.value[0]!.address;
  status.ip = ip;

  // 1. Is it authoritative for the zone?
  try {
    const msg = decodeMessage(await o.transport.udp(ip, encodeQuery(domain, TYPE.SOA), o.timeoutMs));
    const soa = msg.answers.find((a) => a.type === TYPE.SOA);
    status.authoritative = msg.rcode === 0 && msg.aa && !!soa;
    if (soa) {
      const f = soaFields(msg, soa);
      status.serial = f.serial;
      status.primary = f.mname;
    }
    if (!status.authoritative) status.error = msg.rcode ? RCODE[msg.rcode] ?? `rcode ${msg.rcode}` : "not authoritative (no AA)";
  } catch (err) {
    status.error = `no answer (${(err as Error).message})`;
  }

  // 2. Anonymous zone transfer.
  try {
    const msgs = (await o.transport.tcp(ip, encodeQuery(domain, TYPE.AXFR), o.timeoutMs, 2)).map(decodeMessage);
    const records = msgs.reduce((n, m) => n + (m.rcode === 0 ? m.answers.length : 0), 0);
    // A transfer starts with the SOA and carries more records; a refusal is an rcode or nothing.
    status.axfr = msgs[0]?.rcode === 0 && msgs[0].answers[0]?.type === TYPE.SOA && records > 1 ? "allowed" : "refused";
  } catch {
    status.axfr = "unreachable";
  }

  // 3. Open recursion.
  try {
    const msg = decodeMessage(await o.transport.udp(ip, encodeQuery(o.recursionProbe, TYPE.A, { recursion: true }), o.timeoutMs));
    status.openResolver = msg.ra && msg.rcode === 0 && msg.answers.length > 0;
  } catch {
    status.openResolver = false;
  }
  return status;
}

/** Query each nameserver of a zone directly: delegation, serial sync, AXFR and open recursion. */
export async function checkNameservers(
  domain: string,
  nsHosts: string[],
  r: DnsResolver,
  options: NameserverOptions = {}
): Promise<NameserverReport> {
  const o: Required<NameserverOptions> = {
    transport: options.transport ?? socketTransport,
    timeoutMs: options.timeoutMs ?? 4000,
    recursionProbe: options.recursionProbe ?? "dns.google",
  };
  const hosts = [...new Set(nsHosts.map((h) => h.toLowerCase().replace(/\.$/, "")))];
  const servers = await Promise.all(hosts.map((h) => probeServer(domain, h, r, o)));
  const findings: Finding[] = [];

  for (const s of servers) {
    if (!s.ip) {
      findings.push({ severity: "high", code: "NS_UNRESOLVABLE", message: `Nameserver ${s.host} ${s.error}; resolvers that pick it fail` });
    } else if (s.authoritative === false || (s.authoritative === undefined && s.error)) {
      findings.push({
        severity: "high",
        code: "NS_LAME",
        message: `Nameserver ${s.host} (${s.ip}) is listed for ${domain} but does not serve it: ${s.error} (lame delegation; a share of lookups fail or slow down)`,
      });
    }
    if (s.axfr === "allowed") {
      findings.push({
        severity: "high",
        code: "NS_AXFR_ALLOWED",
        message: `Nameserver ${s.host} (${s.ip}) allows zone transfer (AXFR) to anyone: every record in ${domain}, including internal hosts, can be downloaded`,
      });
    }
    if (s.openResolver) {
      findings.push({
        severity: "medium",
        code: "NS_OPEN_RESOLVER",
        message: `Nameserver ${s.host} (${s.ip}) answers recursive queries for anyone; it can be abused for DNS amplification attacks and cache poisoning`,
      });
    }
  }

  // Multi-provider setups (e.g. NS1 + Route 53) each keep their own SOA; compare within one primary only.
  const byPrimary = new Map<string, Set<number>>();
  for (const s of servers) {
    if (!s.authoritative || s.serial === undefined || !s.primary) continue;
    byPrimary.set(s.primary, (byPrimary.get(s.primary) ?? new Set()).add(s.serial));
  }
  for (const [primary, serials] of byPrimary) {
    if (serials.size > 1) {
      findings.push({
        severity: "low",
        code: "NS_SOA_SERIAL_MISMATCH",
        message: `Nameservers of primary ${primary} return different SOA serials (${[...serials].join(", ")}); secondaries may be out of sync (normal for a few minutes after a change)`,
      });
    }
  }
  return { servers, findings };
}
