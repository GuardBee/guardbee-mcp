import { lookup, valueOf, normalizeDomain, systemResolver, type DnsResolver } from "./resolver.js";
import { evaluateSpf, isSpfRecord, countLookupTerms } from "./spf.js";
import { checkTakeover, type TakeoverFinding } from "./takeover.js";
import { discoverFromCT, type CtDiscovery, type CtOptions } from "./ct.js";
import { checkDkim, checkMx, checkMtaSts, checkTlsRpt, suggestSpf, type DkimKeyInfo, type MtaStsCheck } from "./email.js";
import { checkDnssec, type DnssecStatus } from "./dnssec.js";
import { checkCaa, type CaaCheck, type CaaResolver } from "./caa.js";
import { checkNameservers, type NameserverReport } from "./nameservers.js";
import type { DnsTransport } from "./wire.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DnsRecord {
  type: string;
  value: string;
  ttl?: number;
}

export interface SpfAnalysis {
  raw: string;
  valid: boolean;
  mechanisms: string[];
  allMechanism: string | null; // "+all", "-all", "~all", "?all"
  /** DNS-querying terms in this record alone. */
  lookupCount: number;
  /** Including nested include/redirect records (what receivers count); set by enumerateDomain. */
  totalLookups?: number;
  voidLookups?: number;
  included?: string[];
  issues: Finding[];
}

export interface DmarcAnalysis {
  raw: string;
  valid: boolean;
  policy: string | null; // "none", "quarantine", "reject"
  pct: number;
  rua: string[];
  ruf: string[];
  /** Policy for subdomains (`sp`), defaulting to `p`. */
  subdomainPolicy: string | null;
  /** Where the record was found when inherited from a parent domain (e.g. "_dmarc.example.com"). */
  inheritedFrom?: string;
  issues: Finding[];
}

export interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  code: string;
  message: string;
}

export interface DnsEnumerationResult {
  domain: string;
  records: Record<string, DnsRecord[]>;
  spf?: SpfAnalysis;
  dmarc?: DmarcAnalysis;
  dkimSelectors?: Record<string, boolean>; // selector → found
  /** True when a nameserver allowed an anonymous AXFR; undefined when not probed. */
  zoneTransferVulnerable?: boolean;
  /** Per-nameserver results of the direct probes (zone apexes only). */
  nameservers?: NameserverReport["servers"];
  /** False when the domain does not exist (NXDOMAIN). */
  exists?: boolean;
  /** DKIM keys found under the probed selectors, with size and flags. */
  dkimKeys?: DkimKeyInfo[];
  /** "0 ." MX: the domain accepts no mail. */
  nullMx?: boolean;
  mtaSts?: MtaStsCheck;
  tlsRpt?: { record?: string };
  dnssec?: DnssecStatus;
  caa?: CaaCheck;
  findings: Finding[];
}

export interface EnumerateOptions {
  resolver?: DnsResolver;
  /** Fetch pages to match takeover fingerprints (default true). DNS-only checks still run when false. */
  http?: boolean;
  fetch?: typeof fetch;
  /** Add names from Certificate Transparency logs (crt.sh, Cert Spotter). Off unless set. */
  ct?: boolean | CtOptions;
  /** DKIM selectors to probe instead of the built-in list. */
  dkimSelectors?: string[];
  /** CAA lookups (tests); defaults to dns.resolveCaa. */
  caaResolver?: CaaResolver;
  /** Issuer of the certificate served on :443 (tests); defaults to a TLS handshake. */
  certificateIssuer?: (host: string) => Promise<string | undefined>;
  /** Query each nameserver directly: delegation, serials, AXFR, open recursion (default true). */
  nsProbe?: boolean;
  /** DNS sockets for the nameserver probes (tests). */
  dnsTransport?: DnsTransport;
}

export interface SubdomainResult {
  subdomain: string;
  resolves: boolean;
  addresses?: string[];
  cname?: string;
  /** True when a takeover was detected (see `takeover`). */
  dangling?: boolean;
  danglingReason?: string;
  takeover?: TakeoverFinding;
  /** Where the name came from: the built-in wordlist and/or Certificate Transparency logs. */
  sources?: Array<"wordlist" | "ct">;
}

// ── Common subdomain wordlist ─────────────────────────────────────────────────

const COMMON_SUBDOMAINS = [
  "www", "mail", "smtp", "imap", "pop", "ftp", "sftp", "ssh",
  "api", "api2", "api-v2", "v1", "v2", "rest",
  "dev", "staging", "stage", "uat", "qa", "test", "demo",
  "admin", "dashboard", "portal", "app", "apps",
  "cdn", "static", "assets", "media", "img", "images",
  "auth", "login", "sso", "oauth",
  "blog", "docs", "help", "support", "status",
  "mx", "ns", "ns1", "ns2", "dns", "dns1", "dns2",
  "vpn", "remote", "gateway", "proxy",
  "shop", "store", "pay", "checkout",
  "m", "mobile", "wap",
  "beta", "alpha", "preview",
  "git", "gitlab", "github", "jenkins", "ci", "jira", "confluence",
  "monitoring", "grafana", "kibana", "elastic",
  "s3", "storage", "backup",
  "_dmarc", "_domainkey",
];

// ── DNS helpers ───────────────────────────────────────────────────────────────

async function resolveAll(
  domain: string,
  r: DnsResolver
): Promise<{ records: Record<string, DnsRecord[]>; exists: boolean; mx: Array<{ priority: number; exchange: string }> }> {
  const records: Record<string, DnsRecord[]> = {};

  const [a, aaaa, mx, ns, txt, cname, soa] = await Promise.all([
    lookup(() => r.resolve4(domain, { ttl: true })),
    lookup(() => r.resolve6(domain, { ttl: true })),
    lookup(() => r.resolveMx(domain)),
    lookup(() => r.resolveNs(domain)),
    lookup(() => r.resolveTxt(domain)),
    lookup(() => r.resolveCname(domain)),
    lookup(() => r.resolveSoa(domain)),
  ]);
  // Every query answered "no such name": the domain does not exist.
  const exists = ![a, aaaa, mx, ns, txt, soa].every((x) => x.status === "nxdomain");

  const A = valueOf(a);
  if (A?.length) records["A"] = A.map((x) => ({ type: "A", value: x.address, ttl: x.ttl }));
  const AAAA = valueOf(aaaa);
  if (AAAA?.length) records["AAAA"] = AAAA.map((x) => ({ type: "AAAA", value: x.address, ttl: x.ttl }));
  const MX = valueOf(mx);
  if (MX?.length) {
    records["MX"] = [...MX].sort((x, y) => x.priority - y.priority).map((x) => ({ type: "MX", value: `${x.priority} ${x.exchange}` }));
  }
  const NS = valueOf(ns);
  if (NS?.length) records["NS"] = NS.map((x) => ({ type: "NS", value: x }));
  const TXT = valueOf(txt);
  if (TXT?.length) records["TXT"] = TXT.map((chunks) => ({ type: "TXT", value: chunks.join("") }));
  const CNAME = valueOf(cname);
  if (CNAME?.length) records["CNAME"] = CNAME.map((x) => ({ type: "CNAME", value: x }));
  const SOA = valueOf(soa);
  if (SOA) {
    records["SOA"] = [{
      type: "SOA",
      value: `${SOA.nsname} ${SOA.hostmaster} ${SOA.serial} ${SOA.refresh} ${SOA.retry} ${SOA.expire} ${SOA.minttl}`,
    }];
  }

  return { records, exists, mx: MX ?? [] };
}

// ── SPF analysis ──────────────────────────────────────────────────────────────

export function analyzeSpf(txtRecords: DnsRecord[]): SpfAnalysis | null {
  const spfRecs = txtRecords.filter((r) => isSpfRecord(r.value));
  const spfRec = spfRecs[0];
  if (!spfRec) return null;

  const raw = spfRec.value;
  const parts = raw.split(/\s+/).filter(Boolean);
  const mechanisms = parts.slice(1); // skip "v=spf1"

  const allMech = mechanisms.find((m) => /^[+\-~?]?all$/i.test(m))?.toLowerCase() ?? null;
  const lookupCount = countLookupTerms(raw);

  const issues: Finding[] = [];

  if (!allMech) {
    issues.push({ severity: "medium", code: "SPF_NO_ALL", message: "SPF record has no 'all' mechanism" });
  } else if (allMech === "+all" || allMech === "all") {
    issues.push({ severity: "critical", code: "SPF_PERMISSIVE_ALL", message: `SPF '+all' allows any server to send mail as your domain` });
  } else if (allMech === "?all") {
    issues.push({ severity: "high", code: "SPF_NEUTRAL_ALL", message: `SPF '?all' is neutral — fails to reject unauthorized senders` });
  }

  if (lookupCount > 10) {
    issues.push({ severity: "high", code: "SPF_TOO_MANY_LOOKUPS", message: `SPF has ${lookupCount} DNS lookups (max 10); excess lookups cause SPF failure` });
  }

  if (spfRecs.length > 1) {
    issues.push({ severity: "high", code: "SPF_DUPLICATE", message: `Found ${spfRecs.length} SPF records; only one is allowed (permerror)` });
  }

  return { raw, valid: true, mechanisms, allMechanism: allMech, lookupCount, issues };
}

// ── DMARC analysis ────────────────────────────────────────────────────────────

/** `v=DMARC1; p=reject; rua=mailto:a@b.c?x=y` → { v, p, rua }. Keys are case-insensitive; values may contain "=". */
function dmarcTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    if (!(key in tags)) tags[key] = part.slice(eq + 1).trim();
  }
  return tags;
}

const DMARC_POLICIES = new Set(["none", "quarantine", "reject"]);

export function analyzeDmarc(dmarcTxt: string | null): DmarcAnalysis | null {
  if (!dmarcTxt) return null;

  const raw = dmarcTxt;
  const issues: Finding[] = [];
  const tags = dmarcTags(raw);

  const rawPolicy = tags["p"]?.toLowerCase() ?? null;
  const policy = rawPolicy && DMARC_POLICIES.has(rawPolicy) ? rawPolicy : null;
  const rawSp = tags["sp"]?.toLowerCase();
  const subdomainPolicy = rawSp && DMARC_POLICIES.has(rawSp) ? rawSp : policy;
  const pctParsed = Number.parseInt(tags["pct"] ?? "100", 10);
  const pct = Number.isFinite(pctParsed) ? Math.min(Math.max(pctParsed, 0), 100) : 100;
  const rua = (tags["rua"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ruf = (tags["ruf"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!rawPolicy) {
    issues.push({ severity: "high", code: "DMARC_NO_POLICY", message: "DMARC record missing 'p' policy tag" });
  } else if (!policy) {
    issues.push({ severity: "high", code: "DMARC_INVALID_POLICY", message: `DMARC policy 'p=${tags["p"]}' is not none, quarantine or reject; receivers ignore the record` });
  } else if (policy === "none") {
    issues.push({ severity: "medium", code: "DMARC_POLICY_NONE", message: "DMARC policy is 'none' — emails are not rejected or quarantined" });
  } else if (pct < 100) {
    issues.push({ severity: "low", code: "DMARC_PCT_LOW", message: `DMARC policy '${policy}' applies to only ${pct}% of messages` });
  }

  if (policy && policy !== "none" && subdomainPolicy === "none") {
    issues.push({ severity: "medium", code: "DMARC_SUBDOMAINS_NONE", message: "DMARC 'sp=none' leaves subdomains spoofable even though the domain itself is protected" });
  }

  if (rua.length === 0) {
    issues.push({ severity: "low", code: "DMARC_NO_RUA", message: "No DMARC aggregate report address (rua) configured" });
  }

  return { raw, valid: !!policy, policy, pct, rua, ruf, subdomainPolicy, issues };
}

/**
 * The DMARC record that applies to `domain`: its own `_dmarc` record, or the
 * nearest parent's (receivers use the organizational domain's record, with
 * `sp`, for subdomains). Walks up while at least two labels remain.
 */
async function findDmarc(
  domain: string,
  r: DnsResolver
): Promise<{ raw: string | null; at: string; count: number } | { raw: null; at: null; count: 0 }> {
  const labels = domain.split(".");
  for (let i = 0; labels.length - i >= 2; i++) {
    const at = `_dmarc.${labels.slice(i).join(".")}`;
    const txt = valueOf(await lookup(() => r.resolveTxt(at)));
    const records = (txt ?? []).map((c) => c.join("")).filter((v) => /^v=DMARC1\s*(;|$)/i.test(v));
    if (records.length > 0) return { raw: records.length === 1 ? records[0]! : null, at, count: records.length };
  }
  return { raw: null, at: null, count: 0 };
}

// ── Subdomain enumeration ─────────────────────────────────────────────────────

export interface SubdomainEnumeration {
  results: SubdomainResult[];
  /** Set when *.domain resolves: names answered only by the wildcard are left out of `results`. */
  wildcard?: { addresses: string[]; cname?: string; hidden: number; takeover?: TakeoverFinding };
  /** Set when Certificate Transparency was queried. `resolving` counts CT names that are live now. */
  ct?: CtDiscovery & { resolving: number };
}

export const TAKEOVER_LABEL: Record<TakeoverFinding["risk"], string> = {
  vulnerable: "takeover possible",
  edge: "possible takeover — the provider may require domain verification; check manually",
  stale: "stale CNAME, not a takeover",
};

function withTakeover(res: SubdomainResult, takeover: TakeoverFinding | null): SubdomainResult {
  if (!takeover) return res;
  const reason = `${takeover.provider}: ${TAKEOVER_LABEL[takeover.risk]} — ${takeover.evidence}`;
  // Stale records are reported but do not count as dangling (no takeover).
  return takeover.risk === "stale"
    ? { ...res, danglingReason: reason, takeover }
    : { ...res, dangling: true, danglingReason: reason, takeover };
}

function randomLabel(): string {
  return `gb-wildcard-probe-${Math.random().toString(36).slice(2, 10)}`;
}

async function probe(sub: string, r: DnsResolver): Promise<SubdomainResult> {
  // CNAME first: a name with a CNAME also "has" the target's A records.
  const cname = valueOf(await lookup(() => r.resolveCname(sub)))?.[0];
  const addrs = valueOf(await lookup(() => r.resolve4(sub, { ttl: true })))?.map((a) => a.address);
  if (cname) {
    return { subdomain: sub, resolves: true, cname, ...(addrs?.length ? { addresses: addrs } : {}) };
  }
  if (addrs?.length) return { subdomain: sub, resolves: true, addresses: addrs };
  return { subdomain: sub, resolves: false };
}

/** Wordlist enumeration with wildcard DNS detection (two random labels are probed first). */
export async function enumerateSubdomainsDetailed(
  input: string,
  concurrency: number = 20,
  options: EnumerateOptions = {}
): Promise<SubdomainEnumeration> {
  const r = options.resolver ?? systemResolver;
  const domain = normalizeDomain(input);

  const probes = await Promise.all([probe(`${randomLabel()}.${domain}`, r), probe(`${randomLabel()}.${domain}`, r)]);
  const wildcardHits = probes.filter((p) => p.resolves);
  const wildcardAddrs = new Set(wildcardHits.flatMap((p) => p.addresses ?? []));
  const wildcardCnames = new Set(wildcardHits.map((p) => p.cname).filter((c): c is string => !!c));
  const isWildcardAnswer = (res: SubdomainResult): boolean =>
    wildcardHits.length > 0 &&
    (res.cname ? wildcardCnames.has(res.cname) : (res.addresses ?? []).every((a) => wildcardAddrs.has(a)));

  const ct = options.ct
    ? await discoverFromCT(domain, { fetch: options.fetch, ...(typeof options.ct === "object" ? options.ct : {}) })
    : undefined;

  const sourcesOf = new Map<string, Array<"wordlist" | "ct">>();
  for (const s of COMMON_SUBDOMAINS) sourcesOf.set(`${s}.${domain}`, ["wordlist"]);
  for (const n of ct?.names ?? []) sourcesOf.set(n, [...(sourcesOf.get(n) ?? []), "ct"]);

  const results: SubdomainResult[] = [];
  let hidden = 0;
  let ctResolving = 0;
  const queue = [...sourcesOf.keys()];
  const step = Math.max(1, Math.floor(concurrency));
  for (let i = 0; i < queue.length; i += step) {
    const settled = await Promise.all(queue.slice(i, i + step).map((sub) => probe(sub, r)));
    for (const res of settled) {
      if (!res.resolves) continue;
      const sources = sourcesOf.get(res.subdomain)!;
      if (sources.includes("ct")) ctResolving++;
      if (isWildcardAnswer(res)) hidden++;
      else results.push(ct ? { ...res, sources } : res);
    }
  }

  // Takeover checks on names with a CNAME (few), and on the wildcard itself.
  const takeoverOpts = { http: options.http, fetch: options.fetch };
  const checked = await Promise.all(
    results.map(async (res) => (res.cname ? withTakeover(res, await checkTakeover(res.subdomain, r, takeoverOpts)) : res))
  );
  const wildcardProbe = wildcardHits.find((p) => p.cname);
  const wildcardTakeover = wildcardProbe ? await checkTakeover(wildcardProbe.subdomain, r, takeoverOpts) : null;

  return {
    results: checked,
    ...(ct ? { ct: { ...ct, resolving: ctResolving } } : {}),
    ...(wildcardHits.length > 0
      ? {
          wildcard: {
            addresses: [...wildcardAddrs],
            ...(wildcardCnames.size ? { cname: [...wildcardCnames][0] } : {}),
            hidden,
            ...(wildcardTakeover ? { takeover: wildcardTakeover } : {}),
          },
        }
      : {}),
  };
}

export async function enumerateSubdomains(
  domain: string,
  concurrency: number = 20,
  options: EnumerateOptions = {}
): Promise<SubdomainResult[]> {
  return (await enumerateSubdomainsDetailed(domain, concurrency, options)).results;
}

// ── Main enumeration ──────────────────────────────────────────────────────────

export async function enumerateDomain(input: string, options: EnumerateOptions = {}): Promise<DnsEnumerationResult> {
  const r = options.resolver ?? systemResolver;
  const domain = normalizeDomain(input);
  const findings: Finding[] = [];
  const { records, exists, mx } = await resolveAll(domain, r);

  if (!exists) {
    // Email checks on a name that does not exist would only add noise.
    return {
      domain,
      records,
      exists: false,
      findings: [{ severity: "high", code: "DOMAIN_NOT_FOUND", message: `${domain} does not exist (NXDOMAIN)` }],
    };
  }

  // SPF: the record alone, then the full include tree as receivers count it.
  const mxCheck = await checkMx(mx, r);
  findings.push(...mxCheck.findings);
  const receivesMail = mxCheck.hosts.length > 0;

  const txtRecords = records["TXT"] ?? [];
  const spf = analyzeSpf(txtRecords);
  if (!spf) {
    findings.push(
      receivesMail
        ? { severity: "high", code: "SPF_MISSING", message: `No SPF record for ${domain}, which has MX records: anyone can send mail claiming to be from it, and its own mail relies on DKIM alone to pass DMARC. Start from: ${suggestSpf(mxCheck.hosts)} (add every other service that sends as ${domain})` }
        : { severity: "medium", code: "SPF_MISSING", message: `No SPF record for ${domain}; if it sends no mail, publish "v=spf1 -all" so spoofed mail is rejected` }
    );
  } else {
    const evaluation = await evaluateSpf(domain, spf.raw, r);
    spf.totalLookups = evaluation.lookups;
    spf.voidLookups = evaluation.voidLookups;
    spf.included = evaluation.included;
    // The single-record count is superseded by the nested one.
    spf.issues = [...spf.issues.filter((f) => f.code !== "SPF_TOO_MANY_LOOKUPS"), ...evaluation.issues];
    findings.push(...spf.issues);
  }

  // DMARC (inherited from the parent domain for subdomains)
  const found = await findDmarc(domain, r);
  const dmarc = analyzeDmarc(found.raw);
  if (found.count > 1) {
    findings.push({
      severity: "high",
      code: "DMARC_MULTIPLE",
      message: `${found.at} publishes ${found.count} DMARC records; receivers ignore all of them`,
    });
  } else if (!dmarc) {
    findings.push({ severity: "high", code: "DMARC_MISSING", message: `No DMARC record found at _dmarc.${domain} or a parent domain` });
  } else {
    if (found.at && found.at !== `_dmarc.${domain}`) {
      dmarc.inheritedFrom = found.at;
      // For a subdomain, the parent's `sp` is the policy that applies.
      dmarc.policy = dmarc.subdomainPolicy;
      dmarc.issues = dmarc.issues.filter((f) => f.code !== "DMARC_POLICY_NONE" && f.code !== "DMARC_SUBDOMAINS_NONE");
      if (dmarc.policy === "none") {
        dmarc.issues.push({
          severity: "medium",
          code: "DMARC_POLICY_NONE",
          message: `DMARC inherited from ${found.at} has subdomain policy 'none' — emails are not rejected or quarantined`,
        });
      }
    }
    findings.push(...dmarc.issues);
  }

  // DKIM — common selectors (selectors cannot be listed from DNS)
  const dkim = await checkDkim(domain, r, options.dkimSelectors);
  const dkimSelectors = dkim.found;
  if (dkim.keys.filter((k) => !k.revoked).length === 0) {
    if (receivesMail || spf) {
      findings.push({ severity: "medium", code: "DKIM_NOT_FOUND", message: "No DKIM key found under common selectors (pass yours with dkimSelectors if it uses another)" });
    }
  }
  for (const k of dkim.keys) findings.push(...k.issues);

  // Transport security for inbound mail
  const mtaSts = await checkMtaSts(domain, mxCheck.hosts, r, { http: options.http, fetch: options.fetch });
  findings.push(...mtaSts.findings);
  const tlsRpt = await checkTlsRpt(domain, r, !!mtaSts.record);
  findings.push(...tlsRpt.findings);

  // DNSSEC (via DNS-over-HTTPS) and CAA (plus the live certificate's issuer).
  // Both need more than plain DNS, so `http: false` skips them.
  let dnssec: DnssecStatus | undefined;
  let caa: CaaCheck | undefined;
  if (options.http !== false) {
    [dnssec, caa] = await Promise.all([
      checkDnssec(domain, { fetch: options.fetch }),
      checkCaa(domain, { resolveCaa: options.caaResolver, issuer: options.certificateIssuer }),
    ]);
    findings.push(...dnssec.findings, ...caa.findings);
  }

  // Nameservers — check for single point of failure
  const nsRecords = records["NS"] ?? [];
  let nsReport: NameserverReport | undefined;
  if (options.nsProbe !== false && nsRecords.length > 0) {
    nsReport = await checkNameservers(domain, nsRecords.map((n) => n.value), r, { transport: options.dnsTransport });
    findings.push(...nsReport.findings);
  }
  if (nsRecords.length === 0) {
    // Subdomains usually have no NS of their own; only flag zone apexes (they have an SOA).
    if (records["SOA"]) findings.push({ severity: "high", code: "NS_MISSING", message: "No NS records found" });
  } else if (nsRecords.length < 2) {
    findings.push({ severity: "medium", code: "NS_SINGLE", message: "Only one NS record found; consider adding a secondary nameserver" });
  }

  if (findings.length === 0) {
    findings.push({ severity: "info", code: "OK", message: "No DNS misconfigurations found" });
  }

  return {
    domain,
    records,
    exists: true,
    spf: spf ?? undefined,
    dmarc: dmarc ?? undefined,
    dkimSelectors,
    dkimKeys: dkim.keys,
    ...(mxCheck.nullMx ? { nullMx: true } : {}),
    mtaSts,
    tlsRpt: tlsRpt.record ? { record: tlsRpt.record } : {},
    ...(dnssec ? { dnssec } : {}),
    ...(caa ? { caa } : {}),
    ...(nsReport
      ? { nameservers: nsReport.servers, zoneTransferVulnerable: nsReport.servers.some((s) => s.axfr === "allowed") }
      : {}),
    findings,
  };
}

// ── Report formatter ──────────────────────────────────────────────────────────

export function formatDnsReport(result: DnsEnumerationResult): string {
  const lines: string[] = [`DNS Intelligence Report: ${result.domain}`, "─".repeat(50)];

  // Records summary
  for (const [type, recs] of Object.entries(result.records)) {
    lines.push(`\n${type} Records:`);
    for (const r of recs) lines.push(`  ${r.value}${r.ttl !== undefined ? `  (TTL ${r.ttl}s)` : ""}`);
  }

  if (result.exists === false) {
    lines.push(`\n❌ ${result.domain} does not exist (NXDOMAIN)`);
    return lines.join("\n");
  }

  // SPF
  if (result.spf) {
    lines.push(`\nSPF: ${result.spf.raw}`);
    const lookups =
      result.spf.totalLookups !== undefined
        ? `${result.spf.totalLookups}/10 including nested includes`
        : `${result.spf.lookupCount}`;
    lines.push(`  all-mechanism: ${result.spf.allMechanism ?? "none"} | DNS lookups: ${lookups}`);
  }

  // DMARC
  if (result.dmarc) {
    lines.push(`\nDMARC: ${result.dmarc.raw}${result.dmarc.inheritedFrom ? `  (inherited from ${result.dmarc.inheritedFrom})` : ""}`);
    lines.push(`  policy: ${result.dmarc.policy ?? "none"} | pct: ${result.dmarc.pct}%`);
    if (result.dmarc.rua.length) lines.push(`  rua: ${result.dmarc.rua.join(", ")}`);
  }

  // DKIM
  if (result.dkimKeys) {
    const keys = result.dkimKeys.map((k) =>
      k.revoked ? `${k.selector} (revoked)` : `${k.selector} (${k.keyType}${k.bits ? ` ${k.bits}-bit` : ""}${k.testing ? ", t=y" : ""})`
    );
    lines.push(`\nDKIM keys found: ${keys.length ? keys.join(", ") : "none"}`);
  } else if (result.dkimSelectors) {
    const found = Object.entries(result.dkimSelectors).filter(([, v]) => v).map(([k]) => k);
    lines.push(`\nDKIM selectors found: ${found.length ? found.join(", ") : "none"}`);
  }

  // Nameserver probes
  if (result.nameservers) {
    lines.push("\nNameserver checks:");
    for (const s of result.nameservers) {
      const state = !s.ip
        ? s.error
        : [
            s.authoritative ? `authoritative, serial ${s.serial}` : `NOT authoritative (${s.error})`,
            `AXFR ${s.axfr}`,
            s.openResolver ? "OPEN RESOLVER" : "no open recursion",
          ].join(" | ");
      lines.push(`  ${s.host}${s.ip ? ` (${s.ip})` : ""}: ${state}`);
    }
  }

  // DNSSEC and CAA
  if (result.dnssec) {
    const d = result.dnssec;
    const detail = [d.algorithms.join("/"), d.dsDigests.length ? `DS ${d.dsDigests.join("/")}` : ""].filter(Boolean).join(", ");
    lines.push(`\nDNSSEC: ${d.status}${detail ? ` (${detail})` : ""}`);
  }
  if (result.caa) {
    const c = result.caa;
    const where = c.at && c.at !== result.domain ? ` (from ${c.at})` : "";
    lines.push(
      `CAA: ${c.at ? `issue ${c.issue.map((x) => x || "none").join(", ") || "—"}${c.issuewild.length ? ` | issuewild ${c.issuewild.map((x) => x || "none").join(", ")}` : ""}${where}` : "none"}` +
        (c.currentIssuer ? ` | current certificate: ${c.currentIssuer}` : "")
    );
  }

  // Inbound transport security
  if (result.mtaSts) {
    const p = result.mtaSts.policy;
    lines.push(
      `MTA-STS: ${result.mtaSts.record ? (p ? `mode ${p.mode}, mx ${p.mx.join(" ")}, max_age ${p.maxAge}` : "announced, policy not loaded") : "not set up"}` +
        ` | TLS-RPT: ${result.tlsRpt?.record ? "yes" : "no"}`
    );
  }

  // Findings
  const issues = result.findings.filter((f) => f.code !== "OK");
  if (issues.length === 0) {
    lines.push("\n✅ No DNS misconfigurations found");
  } else {
    lines.push(`\n⚠️  ${issues.length} finding(s):`);
    for (const f of issues) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.message}`);
    }
  }

  return lines.join("\n");
}

export function formatSubdomainReport(
  domain: string,
  results: SubdomainResult[],
  wildcard?: SubdomainEnumeration["wildcard"],
  ct?: SubdomainEnumeration["ct"]
): string {
  const dangling = results.filter((r) => r.dangling);
  const lines = [
    `Subdomain Enumeration: ${domain}`,
    `─────────────────────────────────────────`,
    `Found ${results.length} live subdomain(s)${dangling.length ? `, ${dangling.length} potentially dangling` : ""}`,
  ];
  if (ct) {
    const used = ct.sources.filter((s) => s.ok).map((s) => `${s.source} ${s.count}`);
    const failed = ct.sources.filter((s) => !s.ok).map((s) => `${s.source}: ${s.error}`);
    lines.push(
      `🔎 Certificate Transparency: ${ct.names.length} name(s)${used.length ? ` (${used.join(", ")})` : ""}, ${ct.resolving} resolve now` +
        (ct.truncated ? "; list capped" : "") +
        (failed.length ? ` — unavailable: ${failed.join("; ")}` : "")
    );
    if (used.length === 0) lines.push("   Only the built-in wordlist was used; run again later for CT results.");
  }
  if (wildcard) {
    const target = wildcard.cname ? `CNAME ${wildcard.cname}` : wildcard.addresses.join(", ");
    lines.push(
      `ℹ️  Wildcard DNS: *.${domain} → ${target}. ${wildcard.hidden} name(s) answered only by the wildcard are not listed.`
    );
    if (wildcard.takeover && wildcard.takeover.risk !== "stale") {
      lines.push(
        `⚠️  WILDCARD TAKEOVER (${wildcard.takeover.provider}): ${wildcard.takeover.evidence} — every name under ${domain} without its own record can be served by whoever claims it.`
      );
    }
  }
  lines.push("");

  for (const r of results) {
    const flag = r.dangling ? "⚠️  DANGLING" : r.takeover?.risk === "stale" ? "🧹 STALE   " : "✅";
    const target = r.cname ? `→ CNAME ${r.cname}` : (r.addresses?.join(", ") ?? "");
    const via = r.sources && !r.sources.includes("wordlist") ? "  [CT]" : "";
    lines.push(`${flag}  ${r.subdomain.padEnd(45)} ${target}${via}`);
    if (r.danglingReason) {
      lines.push(`      └─ ${r.danglingReason}`);
      if (r.dangling && r.takeover) lines.push(`      └─ Fix: delete the CNAME record, or reclaim the ${r.takeover.provider} resource it points to.`);
    }
  }

  return lines.join("\n");
}
