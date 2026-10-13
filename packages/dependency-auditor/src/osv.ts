import type { Exploitability } from "./exploit.js";

export type Ecosystem = "npm" | "PyPI" | "crates.io" | "Maven" | "Go" | "RubyGems";

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package: { name: string; ecosystem: string };
    ranges?: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
    versions?: string[];
  }>;
  references?: Array<{ type: string; url: string }>;
  aliases?: string[];
  database_specific?: { severity?: string; cwe_ids?: string[] };
  /** Not from OSV: KEV / EPSS data added by enrichExploitability(). */
  exploit?: Exploitability;
}

export interface AuditResult {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  vulns: OsvVuln[];
}

const OSV_API = "https://api.osv.dev/v1";
const BATCH_SIZE = 1000;
const HYDRATE_CONCURRENCY = 8;
const MAX_ATTEMPTS = 3;

type PackageQuery = { name: string; version: string; ecosystem: Ecosystem };
type BatchResult = { vulns?: Array<{ id: string }>; next_page_token?: string };

// Full records keyed by ID. Advisories are immutable enough within one process lifetime.
const vulnCache = new Map<string, OsvVuln>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** fetch with retries on network errors, 429 and 5xx. Other statuses are returned as-is. */
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status !== 429 && res.status < 500) return res;
      lastError = new Error(`OSV API error: ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(250 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function postBatch(
  queries: Array<PackageQuery & { pageToken?: string }>
): Promise<BatchResult[]> {
  const body = {
    queries: queries.map((p) => ({
      version: p.version,
      package: { name: p.name, ecosystem: p.ecosystem },
      ...(p.pageToken ? { page_token: p.pageToken } : {}),
    })),
  };
  const res = await fetchWithRetry(`${OSV_API}/querybatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OSV API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { results?: BatchResult[] };
  return data.results ?? [];
}

/**
 * The querybatch endpoint returns only `{ id, modified }` per vulnerability.
 * Severity, summary, aliases and affected ranges come from GET /vulns/{id}.
 * Throws if any record cannot be fetched: an audit that silently drops
 * severity would let a CI gate pass on unknown findings.
 */
async function hydrate(ids: string[]): Promise<Map<string, OsvVuln>> {
  const missing = [...new Set(ids)].filter((id) => !vulnCache.has(id));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < missing.length) {
      const id = missing[next++]!;
      const res = await fetchWithRetry(`${OSV_API}/vulns/${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error(`OSV API error fetching ${id}: ${res.status}`);
      }
      vulnCache.set(id, (await res.json()) as OsvVuln);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(HYDRATE_CONCURRENCY, missing.length) }, worker)
  );
  return vulnCache;
}

export async function queryOsvBatch(packages: PackageQuery[]): Promise<AuditResult[]> {
  const idsPerPackage: string[][] = packages.map(() => []);

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    let pending = packages
      .slice(i, i + BATCH_SIZE)
      .map((p, j) => ({ ...p, index: i + j, pageToken: undefined as string | undefined }));

    // A query with many advisories is paginated; re-ask only those with a token.
    while (pending.length > 0) {
      const results = await postBatch(pending);
      const again: typeof pending = [];
      pending.forEach((q, j) => {
        const r = results[j];
        for (const v of r?.vulns ?? []) idsPerPackage[q.index]!.push(v.id);
        if (r?.next_page_token) again.push({ ...q, pageToken: r.next_page_token });
      });
      pending = again;
    }
  }

  const records = await hydrate(idsPerPackage.flat());

  return packages.map((p, i) => ({
    name: p.name,
    version: p.version,
    ecosystem: p.ecosystem,
    // Copies: callers annotate findings (e.g. `exploit`) and must not touch the cache.
    vulns: mergeAliases([...new Set(idsPerPackage[i])].map((id) => ({ ...records.get(id)! }))),
  }));
}

/** Records with severity data first, then GHSA, then anything else. */
function representativeRank(v: OsvVuln): number {
  const scored = (v.severity?.length ?? 0) > 0 || !!v.database_specific?.severity;
  return (scored ? 0 : 2) + (v.id.startsWith("GHSA-") ? 0 : 1);
}

/**
 * OSV often returns one issue under several IDs that alias each other
 * (GHSA + PYSEC for PyPI, GHSA + MAL for malware). Merge each alias group
 * into one record so a finding is counted once. The merged record keeps every
 * ID in `aliases`, so ignore lists and malware detection still match on any of them.
 */
export function mergeAliases(vulns: OsvVuln[]): OsvVuln[] {
  const parent = vulns.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  vulns.forEach((v, i) => {
    for (const id of [v.id, ...(v.aliases ?? [])]) {
      const j = owner.get(id);
      if (j === undefined) owner.set(id, i);
      else parent[find(i)] = find(j);
    }
  });

  const groups = new Map<number, OsvVuln[]>();
  vulns.forEach((v, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), v]);
  });

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const [rep, ...rest] = [...group].sort((a, b) => representativeRank(a) - representativeRank(b));
    const ids = new Set(group.flatMap((v) => [v.id, ...(v.aliases ?? [])]));
    ids.delete(rep!.id);
    return {
      ...rep!,
      summary: rep!.summary ?? rest.find((v) => v.summary)?.summary,
      affected: rep!.affected ?? rest.find((v) => v.affected)?.affected,
      aliases: [...ids].sort(),
    };
  });
}

/**
 * A known-malicious release: an OpenSSF malicious-packages entry (MAL-*),
 * or an advisory classified CWE-506 (embedded malicious code), such as
 * GitHub's malware advisories for hijacked packages.
 */
export function isMalicious(vuln: OsvVuln): boolean {
  if ([vuln.id, ...(vuln.aliases ?? [])].some((id) => id.startsWith("MAL-"))) return true;
  return vuln.database_specific?.cwe_ids?.includes("CWE-506") ?? false;
}

/** Test hook: forget hydrated records between tests. */
export function clearOsvCache(): void {
  vulnCache.clear();
}

type Severity = "critical" | "high" | "medium" | "low" | "unknown";

function band(score: number): Severity {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  return "low";
}

/** FIRST.org Roundup to one decimal place. */
function roundup1(input: number): number {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

function vectorMetrics(score: string): Record<string, string> {
  const metrics: Record<string, string> = {};
  for (const part of score.split("/")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    if (key === "CVSS") continue;
    metrics[key] = part.slice(idx + 1);
  }
  return metrics;
}

const AV3: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const AC3: Record<string, number> = { L: 0.77, H: 0.44 };
const PR3_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PR3_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
const UI3: Record<string, number> = { N: 0.85, R: 0.62 };
const CIA3: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

function cvssV3Base(score: string): number | null {
  if (!score.startsWith("CVSS:3.")) return null;
  const m = vectorMetrics(score);
  const av = AV3[m.AV ?? ""];
  const ac = AC3[m.AC ?? ""];
  const ui = UI3[m.UI ?? ""];
  const c = CIA3[m.C ?? ""];
  const i = CIA3[m.I ?? ""];
  const a = CIA3[m.A ?? ""];
  const scopeChanged = m.S === "C";
  const pr = (scopeChanged ? PR3_CHANGED : PR3_UNCHANGED)[m.PR ?? ""];
  if ([av, ac, ui, c, i, a, pr].some((n) => n === undefined)) return null;

  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  const impact = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  if (impact <= 0) return 0;
  const impactSub = scopeChanged
    ? 7.52 * (impact - 0.029) - 3.25 * (impact - 0.02) ** 15
    : 6.42 * impact;
  const base = scopeChanged
    ? Math.min(1.08 * (impactSub + exploitability), 10)
    : Math.min(impactSub + exploitability, 10);
  return roundup1(base);
}

const AV2: Record<string, number> = { L: 0.395, A: 0.646, N: 1.0 };
const AC2: Record<string, number> = { H: 0.35, M: 0.61, L: 0.71 };
const AU2: Record<string, number> = { M: 0.45, S: 0.56, N: 0.704 };
const CIA2: Record<string, number> = { N: 0, P: 0.275, C: 0.66 };

function cvssV2Base(score: string): number | null {
  if (!score.startsWith("CVSS:2") && !score.startsWith("AV:")) return null;
  const m = vectorMetrics(score);
  const av = AV2[m.AV ?? ""];
  const ac = AC2[m.AC ?? ""];
  const au = AU2[m.Au ?? ""];
  const c = CIA2[m.C ?? ""];
  const i = CIA2[m.I ?? ""];
  const a = CIA2[m.A ?? ""];
  if ([av, ac, au, c, i, a].some((n) => n === undefined)) return null;
  const impact = 10.41 * (1 - (1 - c!) * (1 - i!) * (1 - a!));
  const exploitability = 20 * av! * ac! * au!;
  const fImpact = impact === 0 ? 0 : 1.176;
  return roundup1((0.6 * impact + 0.4 * exploitability - 1.5) * fImpact);
}

function numericCvss(score: string): number | null {
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(score)) return parseFloat(score);
  return cvssV3Base(score) ?? cvssV2Base(score);
}

function ratedSeverity(label: string | undefined): Severity | null {
  switch (label?.toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MODERATE":
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return null;
  }
}

export function getSeverity(vuln: OsvVuln): Severity {
  // MAL-* records carry no score; installing malware is always critical.
  if (isMalicious(vuln)) return "critical";

  for (const s of vuln.severity ?? []) {
    if (s.type === "CVSS_V3" || s.type === "CVSS_V2" || s.type === "CVSS_V4") {
      const score = numericCvss(s.score);
      if (score !== null) return band(score);
    }
  }

  const rated = ratedSeverity(vuln.database_specific?.severity);
  if (rated) return rated;

  // Fall back to text heuristics in summary
  const text = (vuln.summary ?? vuln.details ?? "").toLowerCase();
  if (text.includes("critical") || text.includes("rce") || text.includes("remote code")) return "critical";
  if (text.includes("high") || text.includes("sql injection") || text.includes("auth bypass")) return "high";
  if (text.includes("medium") || text.includes("xss") || text.includes("csrf")) return "medium";
  if (text.includes("low") || text.includes("info")) return "low";

  return "unknown";
}

export function getFixedVersion(vuln: OsvVuln, pkgName: string): string | null {
  for (const affected of vuln.affected ?? []) {
    if (affected.package.name.toLowerCase() !== pkgName.toLowerCase()) continue;
    for (const range of affected.ranges ?? []) {
      for (const event of range.events) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}
