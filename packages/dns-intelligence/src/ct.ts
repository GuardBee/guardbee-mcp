/**
 * Passive subdomain discovery from Certificate Transparency logs: every
 * publicly trusted certificate lists its hostnames, so CT reveals names a
 * wordlist cannot guess. Two free sources are queried in parallel because
 * each one is regularly unavailable; whichever answers is used.
 * Only the domain name is sent to them.
 */

export type CtSourceName = "crt.sh" | "certspotter";

export interface CtSourceResult {
  source: CtSourceName;
  ok: boolean;
  /** Names under the domain this source returned. */
  count: number;
  error?: string;
}

export interface CtDiscovery {
  names: string[];
  sources: CtSourceResult[];
  /** More names were found than `maxNames`; the rest were dropped. */
  truncated: boolean;
}

export interface CtOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Cap on names returned (each one costs DNS lookups). Default 500. */
  maxNames?: number;
  /** Cert Spotter pages to follow. Default 5. */
  maxPages?: number;
  /** Wait before retrying a 5xx from crt.sh. Default 2000 ms. */
  retryDelayMs?: number;
}

const HOSTNAME = /^([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** "*.Api.Example.com." → "api.example.com"; null if not a hostname under `domain`. */
export function normalizeCtName(raw: string, domain: string): string | null {
  const name = raw.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  if (name === domain || !name.endsWith(`.${domain}`) || !HOSTNAME.test(name)) return null;
  return name;
}

async function getJson(f: typeof fetch, url: string, timeoutMs: number): Promise<{ data: unknown }> {
  const res = await f(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "GuardBee-DNS-Intelligence/1 (+https://guardbee.ai)", accept: "application/json" },
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return { data: await res.json() };
}

async function fromCrtSh(domain: string, f: typeof fetch, opts: Required<Pick<CtOptions, "timeoutMs" | "retryDelayMs">>): Promise<string[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await getJson(f, url, opts.timeoutMs);
      return (data as Array<{ name_value?: string }>).flatMap((row) => (row.name_value ?? "").split("\n"));
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (!status || status < 500 || attempt === 1) break;
      await new Promise((r) => setTimeout(r, opts.retryDelayMs));
    }
  }
  throw lastError;
}

async function fromCertSpotter(domain: string, f: typeof fetch, opts: Required<Pick<CtOptions, "timeoutMs" | "maxPages">>): Promise<string[]> {
  const names: string[] = [];
  const base = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names`;
  // Page with ?after=<last id>. The API's own Link: rel="next" omits the /v1 prefix and 404s.
  let after: string | undefined;
  for (let page = 0; page < opts.maxPages; page++) {
    let rows: Array<{ id?: string; dns_names?: string[] }>;
    try {
      rows = (await getJson(f, after ? `${base}&after=${encodeURIComponent(after)}` : base, opts.timeoutMs)).data as typeof rows;
    } catch (err) {
      if (page === 0) throw err;
      break; // keep what earlier pages returned (e.g. rate limited mid-way)
    }
    if (rows.length === 0) break;
    names.push(...rows.flatMap((r) => r.dns_names ?? []));
    after = rows[rows.length - 1]?.id;
    if (!after) break;
  }
  return names;
}

export async function discoverFromCT(domain: string, options: CtOptions = {}): Promise<CtDiscovery> {
  const f = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxNames = options.maxNames ?? 500;

  const sources: Array<[CtSourceName, () => Promise<string[]>]> = [
    ["crt.sh", () => fromCrtSh(domain, f, { timeoutMs, retryDelayMs: options.retryDelayMs ?? 2000 })],
    ["certspotter", () => fromCertSpotter(domain, f, { timeoutMs, maxPages: options.maxPages ?? 5 })],
  ];
  const settled = await Promise.allSettled(sources.map(([, run]) => run()));

  const all = new Set<string>();
  const results: CtSourceResult[] = settled.map((s, i) => {
    const source = sources[i]![0];
    if (s.status === "rejected") {
      const e = s.reason as Error;
      return { source, ok: false, count: 0, error: e.name === "TimeoutError" ? "timed out" : e.message };
    }
    const mine = new Set(s.value.map((n) => normalizeCtName(n, domain)).filter((n): n is string => n !== null));
    for (const n of mine) all.add(n);
    return { source, ok: true, count: mine.size };
  });

  const names = [...all].sort();
  return { names: names.slice(0, maxNames), sources: results, truncated: names.length > maxNames };
}
