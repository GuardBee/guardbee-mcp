import { lookup, type DnsResolver } from "./resolver.js";

/**
 * Subdomain takeover fingerprints. Each HTTP fingerprint below was checked
 * against a random unclaimed name on the provider (October 2026); providers
 * whose "not found" page no longer carries a stable marker are left out.
 *
 * - "vulnerable": anyone can claim the resource behind the CNAME; the
 *   provider does not ask the claimant to prove they own the domain.
 * - "edge": the resource is gone, but the provider offers domain
 *   verification (e.g. GitHub verified domains); a takeover works only if
 *   the domain is not verified there. Check manually.
 */
export interface Fingerprint {
  provider: string;
  cname: RegExp;
  /** "nxdomain": the CNAME target no longer exists. "http": the page contains one of `body`. */
  match: { kind: "nxdomain" } | { kind: "http"; body: string[] };
  risk: "vulnerable" | "edge";
}

export const FINGERPRINTS: Fingerprint[] = [
  { provider: "AWS S3", cname: /\.s3[.-]([a-z0-9-]+\.)*amazonaws\.com$|\.s3-website[.-]([a-z0-9-]+\.)*amazonaws\.com$/, match: { kind: "http", body: ["NoSuchBucket", "The specified bucket does not exist"] }, risk: "vulnerable" },
  { provider: "GitHub Pages", cname: /\.github\.io$/, match: { kind: "http", body: ["There isn't a GitHub Pages site here"] }, risk: "edge" },
  { provider: "Ghost", cname: /\.ghost\.io$/, match: { kind: "http", body: ["Failed to resolve DNS path for this host"] }, risk: "edge" },
  { provider: "Surge.sh", cname: /(^|\.)surge\.sh$/, match: { kind: "http", body: ["project not found"] }, risk: "vulnerable" },
  { provider: "Help Scout", cname: /\.helpscoutdocs\.com$/, match: { kind: "http", body: ["No settings were found for this company"] }, risk: "edge" },
  { provider: "WordPress.com", cname: /\.wordpress\.com$/, match: { kind: "http", body: ["Do you want to register"] }, risk: "edge" },
  { provider: "Pantheon", cname: /\.pantheonsite\.io$/, match: { kind: "http", body: ["404 - Unknown site"] }, risk: "edge" },
  { provider: "Heroku", cname: /\.(herokuapp|herokudns|herokussl)\.com$/, match: { kind: "http", body: ["No such app", "no-such-app.html"] }, risk: "edge" },
  { provider: "Netlify", cname: /\.netlify\.(app|com)$/, match: { kind: "http", body: ["Not Found - Request ID"] }, risk: "edge" },
  { provider: "Vercel", cname: /\.vercel\.app$|(^|\.)vercel-dns\.com$/, match: { kind: "http", body: ["DEPLOYMENT_NOT_FOUND"] }, risk: "edge" },
  { provider: "Tumblr", cname: /(^|\.)tumblr\.com$/, match: { kind: "http", body: ["Whatever you were looking for doesn't currently exist at this address"] }, risk: "edge" },
  { provider: "ngrok", cname: /\.ngrok(-free)?\.(io|app|dev)$/, match: { kind: "http", body: ["ERR_NGROK_3200"] }, risk: "edge" },
  { provider: "Microsoft Azure", cname: /\.(azurewebsites\.net|cloudapp\.net|cloudapp\.azure\.com|trafficmanager\.net|blob\.core\.windows\.net|azureedge\.net|azure-api\.net|azurehdinsight\.net|azurecontainer\.io|azurefd\.net|azurestaticapps\.net)$/, match: { kind: "nxdomain" }, risk: "vulnerable" },
  { provider: "AWS Elastic Beanstalk", cname: /\.elasticbeanstalk\.com$/, match: { kind: "nxdomain" }, risk: "vulnerable" },
];

export interface TakeoverFinding {
  provider: string;
  /**
   * "stale": the CNAME target is gone, but it sits under a registered domain
   * that only its owner can populate; not a takeover, but worth deleting.
   */
  risk: "vulnerable" | "edge" | "stale";
  /** CNAME chain from the subdomain, first hop first. */
  chain: string[];
  evidence: string;
}

export interface TakeoverOptions {
  /** Fetch the page to match HTTP fingerprints (default true). */
  http?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Follow CNAMEs (up to 5 hops). */
async function cnameChain(host: string, r: DnsResolver): Promise<string[]> {
  const chain: string[] = [];
  let cur = host;
  for (let i = 0; i < 5; i++) {
    const res = await lookup(() => r.resolveCname(cur));
    const next = res.status === "ok" ? res.value[0]?.toLowerCase().replace(/\.$/, "") : undefined;
    if (!next || chain.includes(next)) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

/** True when the name answers neither A nor AAAA because it does not exist. */
async function isNxdomain(name: string, r: DnsResolver): Promise<boolean> {
  const [a, aaaa] = await Promise.all([
    lookup(() => r.resolve4(name, { ttl: true })),
    lookup(() => r.resolve6(name, { ttl: true })),
  ]);
  return a.status === "nxdomain" && aaaa.status === "nxdomain";
}

const MAX_BODY = 512 * 1024;

async function fetchBody(host: string, f: typeof fetch, timeoutMs: number): Promise<{ status: number; body: string } | null> {
  // HTTPS first; custom domains on S3 and similar often have no matching certificate, so fall back to HTTP.
  for (const scheme of ["https", "http"]) {
    try {
      const res = await f(`${scheme}://${host}/`, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "GuardBee-DNS-Intelligence/1 (+https://guardbee.ai; subdomain takeover check)" },
      });
      const body = (await res.text()).slice(0, MAX_BODY);
      return { status: res.status, body };
    } catch {
      // try the next scheme
    }
  }
  return null;
}

/**
 * Check one hostname for a takeover: a CNAME (at any hop) to a provider
 * whose resource is gone, or a CNAME target that no longer exists at all.
 */
export async function checkTakeover(
  host: string,
  r: DnsResolver,
  options: TakeoverOptions = {}
): Promise<TakeoverFinding | null> {
  const chain = await cnameChain(host, r);
  if (chain.length === 0) return null;
  const last = chain[chain.length - 1]!;
  const fp = FINGERPRINTS.find((f) => chain.some((c) => f.cname.test(c)));
  const targetGone = await isNxdomain(last, r);

  if (fp?.match.kind === "nxdomain") {
    return targetGone
      ? { provider: fp.provider, risk: fp.risk, chain, evidence: `CNAME target ${last} does not exist (NXDOMAIN)` }
      : null;
  }
  if (fp?.match.kind === "http" && options.http !== false) {
    const page = await fetchBody(host, options.fetch ?? fetch, options.timeoutMs ?? 8000);
    const hit = page && fp.match.body.find((b) => page.body.includes(b));
    if (hit) {
      return { provider: fp.provider, risk: fp.risk, chain, evidence: `HTTP ${page.status}: page says "${hit}"` };
    }
    return null;
  }
  if (targetGone) {
    // Unknown provider: the danger is a target domain anyone can register.
    const domain = registrableDomain(last);
    if (RESERVED_TLD.test(domain)) {
      return { provider: "unknown", risk: "stale", chain, evidence: `CNAME target ${last} does not exist (reserved name)` };
    }
    const ns = await lookup(() => r.resolveNs(domain));
    if (ns.status === "nxdomain") {
      return {
        provider: "unregistered domain",
        risk: "vulnerable",
        chain,
        evidence: `CNAME target ${last} is under ${domain}, which is not registered — anyone can register it and serve this hostname`,
      };
    }
    return {
      provider: domain,
      risk: "stale",
      chain,
      evidence: `CNAME target ${last} does not exist; ${domain} is registered, so only its owner can create it — delete the stale record`,
    };
  }
  return null;
}

/** Reserved TLDs that can never be registered (RFC 2606 / 6761). */
const RESERVED_TLD = /\.(invalid|test|example|localhost|local)$/;

/** Second-level labels that sit under a ccTLD as public suffixes (co.uk, com.tr, …). */
const PUBLIC_SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gen", "biz", "info", "k12", "mil", "nom", "web"]);

/**
 * Approximate registrable domain without a public suffix list:
 * "a.b.example.com" → "example.com", "x.example.co.uk" → "example.co.uk".
 */
export function registrableDomain(name: string): string {
  const labels = name.toLowerCase().replace(/\.$/, "").split(".");
  const n = labels.length;
  if (n >= 3 && labels[n - 1]!.length === 2 && PUBLIC_SECOND_LEVEL.has(labels[n - 2]!)) {
    return labels.slice(n - 3).join(".");
  }
  return labels.slice(Math.max(0, n - 2)).join(".");
}
