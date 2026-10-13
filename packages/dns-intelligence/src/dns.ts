import { lookup, valueOf, normalizeDomain, systemResolver, type DnsResolver } from "./resolver.js";
import { evaluateSpf, isSpfRecord, countLookupTerms } from "./spf.js";

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
  /** Not checked yet (requires AXFR over TCP); always undefined in this version. */
  zoneTransferVulnerable?: boolean;
  /** False when the domain does not exist (NXDOMAIN). */
  exists?: boolean;
  findings: Finding[];
}

export interface EnumerateOptions {
  resolver?: DnsResolver;
}

export interface SubdomainResult {
  subdomain: string;
  resolves: boolean;
  addresses?: string[];
  cname?: string;
  dangling?: boolean;
  danglingReason?: string;
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

// Known cloud/hosting services that are common dangling targets
const DANGLING_CNAME_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /\.s3\.amazonaws\.com$/i, provider: "AWS S3" },
  { pattern: /\.azurewebsites\.net$/i, provider: "Azure App Service" },
  { pattern: /\.github\.io$/i, provider: "GitHub Pages" },
  { pattern: /\.herokuapp\.com$/i, provider: "Heroku" },
  { pattern: /\.netlify\.app$/i, provider: "Netlify" },
  { pattern: /\.vercel\.app$/i, provider: "Vercel" },
  { pattern: /\.pages\.dev$/i, provider: "Cloudflare Pages" },
  { pattern: /\.surge\.sh$/i, provider: "Surge" },
  { pattern: /\.pantheonsite\.io$/i, provider: "Pantheon" },
  { pattern: /\.wpengine\.com$/i, provider: "WP Engine" },
  { pattern: /\.ghost\.io$/i, provider: "Ghost" },
  { pattern: /\.myshopify\.com$/i, provider: "Shopify" },
  { pattern: /\.fastly\.net$/i, provider: "Fastly" },
  { pattern: /\.cloudfront\.net$/i, provider: "AWS CloudFront" },
];

// ── DNS helpers ───────────────────────────────────────────────────────────────

async function resolveAll(domain: string, r: DnsResolver): Promise<{ records: Record<string, DnsRecord[]>; exists: boolean }> {
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

  return { records, exists };
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
  wildcard?: { addresses: string[]; cname?: string; hidden: number };
}

function randomLabel(): string {
  return `gb-wildcard-probe-${Math.random().toString(36).slice(2, 10)}`;
}

async function probe(sub: string, r: DnsResolver): Promise<SubdomainResult> {
  // CNAME first: a name with a CNAME also "has" the target's A records.
  const cname = valueOf(await lookup(() => r.resolveCname(sub)))?.[0];
  const addrs = valueOf(await lookup(() => r.resolve4(sub, { ttl: true })))?.map((a) => a.address);
  if (cname) {
    const danglingMatch = DANGLING_CNAME_PATTERNS.find((p) => p.pattern.test(cname));
    if (danglingMatch && !addrs?.length) {
      return {
        subdomain: sub, resolves: true, cname,
        dangling: true, danglingReason: `CNAME points to unclaimed ${danglingMatch.provider} resource`,
      };
    }
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

  const results: SubdomainResult[] = [];
  let hidden = 0;
  const queue = COMMON_SUBDOMAINS.map((s) => `${s}.${domain}`);
  const step = Math.max(1, Math.floor(concurrency));
  for (let i = 0; i < queue.length; i += step) {
    const settled = await Promise.all(queue.slice(i, i + step).map((sub) => probe(sub, r)));
    for (const res of settled) {
      if (!res.resolves) continue;
      if (isWildcardAnswer(res)) hidden++;
      else results.push(res);
    }
  }

  return {
    results,
    ...(wildcardHits.length > 0
      ? { wildcard: { addresses: [...wildcardAddrs], ...(wildcardCnames.size ? { cname: [...wildcardCnames][0] } : {}), hidden } }
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
  const { records, exists } = await resolveAll(domain, r);

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
  const txtRecords = records["TXT"] ?? [];
  const spf = analyzeSpf(txtRecords);
  if (!spf) {
    findings.push({ severity: "medium", code: "SPF_MISSING", message: `No SPF record found for ${domain}` });
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

  // DKIM — check common selectors
  const dkimSelectors: Record<string, boolean> = {};
  const commonSelectors = ["default", "google", "k1", "mail", "dkim", "selector1", "selector2", "s1", "s2"];
  const dkimChecks = await Promise.all(
    commonSelectors.map(async (sel) => {
      const result = valueOf(await lookup(() => r.resolveTxt(`${sel}._domainkey.${domain}`)));
      return { sel, found: !!result?.length };
    })
  );
  for (const { sel, found: ok } of dkimChecks) {
    dkimSelectors[sel] = ok;
  }
  const anyDkim = Object.values(dkimSelectors).some(Boolean);
  if (!anyDkim) {
    findings.push({ severity: "medium", code: "DKIM_NOT_FOUND", message: "No DKIM records found for common selectors" });
  }

  // Nameservers — check for single point of failure
  const nsRecords = records["NS"] ?? [];
  if (nsRecords.length === 0) {
    // Subdomains usually have no NS of their own; only flag zone apexes (they have an SOA).
    if (records["SOA"]) findings.push({ severity: "high", code: "NS_MISSING", message: "No NS records found" });
  } else if (nsRecords.length < 2) {
    findings.push({ severity: "medium", code: "NS_SINGLE", message: "Only one NS record found; consider adding a secondary nameserver" });
  }

  if (findings.length === 0) {
    findings.push({ severity: "info", code: "OK", message: "No DNS misconfigurations found" });
  }

  return { domain, records, exists: true, spf: spf ?? undefined, dmarc: dmarc ?? undefined, dkimSelectors, findings };
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
  if (result.dkimSelectors) {
    const found = Object.entries(result.dkimSelectors).filter(([, v]) => v).map(([k]) => k);
    lines.push(`\nDKIM selectors found: ${found.length ? found.join(", ") : "none"}`);
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
  wildcard?: SubdomainEnumeration["wildcard"]
): string {
  const dangling = results.filter((r) => r.dangling);
  const lines = [
    `Subdomain Enumeration: ${domain}`,
    `─────────────────────────────────────────`,
    `Found ${results.length} live subdomain(s)${dangling.length ? `, ${dangling.length} potentially dangling` : ""}`,
  ];
  if (wildcard) {
    const target = wildcard.cname ? `CNAME ${wildcard.cname}` : wildcard.addresses.join(", ");
    lines.push(
      `ℹ️  Wildcard DNS: *.${domain} → ${target}. ${wildcard.hidden} name(s) answered only by the wildcard are not listed.`
    );
  }
  lines.push("");

  for (const r of results) {
    const flag = r.dangling ? "⚠️  DANGLING" : "✅";
    const target = r.cname ? `→ CNAME ${r.cname}` : (r.addresses?.join(", ") ?? "");
    lines.push(`${flag}  ${r.subdomain.padEnd(45)} ${target}`);
    if (r.dangling && r.danglingReason) {
      lines.push(`      └─ ${r.danglingReason}`);
    }
  }

  return lines.join("\n");
}
