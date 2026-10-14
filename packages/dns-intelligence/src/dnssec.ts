import type { Finding } from "./dns.js";

/**
 * DNSSEC status through DNS-over-HTTPS (Google's JSON API): Node's resolver
 * cannot see DS/DNSKEY records or the AD (authenticated data) flag. The
 * `cd=true` (checking disabled) query is what tells a broken chain apart from
 * an unreachable server. Only the domain name is sent.
 */

export const DOH_ENDPOINT = "https://dns.google/resolve";

interface DohAnswer {
  Status: number; // 0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN
  AD?: boolean;
  Answer?: Array<{ name?: string; type: number; data: string }>;
}

export async function dohQuery(
  name: string,
  type: string,
  opts: { cd?: boolean; fetch?: typeof fetch; endpoint?: string; timeoutMs?: number } = {}
): Promise<DohAnswer> {
  const url = `${opts.endpoint ?? DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}&cd=${opts.cd ? "true" : "false"}`;
  const res = await (opts.fetch ?? fetch)(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  });
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  return (await res.json()) as DohAnswer;
}

const RR = { SOA: 6, DS: 43, DNSKEY: 48 } as const;

/** IANA DNSSEC algorithm numbers. */
export const DNSSEC_ALGORITHMS: Record<number, string> = {
  1: "RSAMD5", 3: "DSA", 5: "RSASHA1", 6: "DSA-NSEC3-SHA1", 7: "RSASHA1-NSEC3-SHA1",
  8: "RSASHA256", 10: "RSASHA512", 12: "ECC-GOST", 13: "ECDSAP256SHA256", 14: "ECDSAP384SHA384",
  15: "ED25519", 16: "ED448",
};
/** RFC 8624: MUST NOT (1, 3, 6, 12) or NOT RECOMMENDED (5, 7) for signing. */
const DEPRECATED_ALGORITHMS = new Set([1, 3, 5, 6, 7, 12]);
const DS_DIGESTS: Record<number, string> = { 1: "SHA-1", 2: "SHA-256", 3: "GOST", 4: "SHA-384" };

export interface DnssecStatus {
  /**
   * signed: validated chain (AD). unsigned: no DNSSEC. partial: zone signed
   * but no DS at the parent. broken: validation fails, so validating
   * resolvers cannot resolve the name. unchecked: DoH unavailable.
   */
  status: "signed" | "unsigned" | "partial" | "broken" | "unchecked";
  algorithms: string[];
  dsDigests: string[];
  findings: Finding[];
}

/**
 * DS/DNSKEY only exist at zone apexes. The apex is recognised from the SOA
 * answer's owner name (a CNAME'd host gets its target's SOA, owned by another
 * name); for other names only the validation result is reported.
 */
export async function checkDnssec(
  domain: string,
  opts: { fetch?: typeof fetch; endpoint?: string } = {}
): Promise<DnssecStatus> {
  const out: DnssecStatus = { status: "unsigned", algorithms: [], dsDigests: [], findings: [] };
  try {
    const validated = await dohQuery(domain, "SOA", { ...opts, cd: false });
    if (validated.Status === 2) {
      const unchecked = await dohQuery(domain, "SOA", { ...opts, cd: true });
      if (unchecked.Status !== 2) {
        out.status = "broken";
        out.findings.push({
          severity: "critical",
          code: "DNSSEC_BROKEN",
          message: `DNSSEC validation fails for ${domain}: validating resolvers (Google, Cloudflare, most ISPs) return SERVFAIL, so the domain is unreachable for their users. Fix the DS record at the registrar or re-sign the zone`,
        });
        return out;
      }
      out.status = "unchecked"; // the servers themselves fail; not a DNSSEC verdict
      return out;
    }

    const zoneApex = (validated.Answer ?? []).some(
      (a) => a.type === RR.SOA && a.name?.toLowerCase().replace(/\.$/, "") === domain
    );
    if (!zoneApex) {
      out.status = validated.AD ? "signed" : "unsigned";
      return out;
    }

    const [ds, dnskey] = await Promise.all([
      dohQuery(domain, "DS", { ...opts, cd: false }),
      dohQuery(domain, "DNSKEY", { ...opts, cd: true }),
    ]);
    const dsRecords = (ds.Answer ?? []).filter((a) => a.type === RR.DS).map((a) => a.data.split(/\s+/));
    const keys = (dnskey.Answer ?? []).filter((a) => a.type === RR.DNSKEY).map((a) => a.data.split(/\s+/));
    out.dsDigests = [...new Set(dsRecords.map((d) => DS_DIGESTS[Number(d[2])] ?? `type ${d[2]}`))];
    const algs = [...new Set(keys.map((k) => Number(k[2])))];
    out.algorithms = algs.map((a) => DNSSEC_ALGORITHMS[a] ?? `algorithm ${a}`);

    if (dsRecords.length === 0 && keys.length === 0) {
      out.status = "unsigned";
      out.findings.push({
        severity: "low",
        code: "DNSSEC_DISABLED",
        message: `${domain} is not signed with DNSSEC; a resolver can be fed forged answers (cache poisoning). Enable signing at the DNS host and publish the DS at the registrar`,
      });
      return out;
    }
    if (dsRecords.length === 0) {
      out.status = "partial";
      out.findings.push({
        severity: "medium",
        code: "DNSSEC_NO_DS",
        message: `${domain} publishes DNSKEY records but the parent zone has no DS, so nothing is validated; add the DS record at the registrar`,
      });
    } else {
      out.status = validated.AD ? "signed" : "partial";
    }

    const weak = algs.filter((a) => DEPRECATED_ALGORITHMS.has(a));
    if (weak.length > 0) {
      out.findings.push({
        severity: "medium",
        code: "DNSSEC_WEAK_ALGORITHM",
        message: `DNSSEC keys use deprecated algorithm(s) ${weak.map((a) => DNSSEC_ALGORITHMS[a]).join(", ")} (RFC 8624); roll to ECDSAP256SHA256 (13)`,
      });
    }
    if (dsRecords.some((d) => d[2] === "1") && !dsRecords.some((d) => d[2] !== "1")) {
      out.findings.push({
        severity: "low",
        code: "DNSSEC_DS_SHA1",
        message: "The only DS digest is SHA-1; publish a SHA-256 (type 2) DS record",
      });
    }
    return out;
  } catch {
    return { status: "unchecked", algorithms: [], dsDigests: [], findings: [] };
  }
}
