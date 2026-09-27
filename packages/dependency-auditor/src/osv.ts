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
  database_specific?: { severity?: string };
}

export interface AuditResult {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  vulns: OsvVuln[];
}

const OSV_API = "https://api.osv.dev/v1";
const BATCH_SIZE = 1000;

export async function queryOsvBatch(
  packages: Array<{ name: string; version: string; ecosystem: Ecosystem }>
): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const batch = packages.slice(i, i + BATCH_SIZE);
    const body = {
      queries: batch.map((p) => ({
        version: p.version,
        package: { name: p.name, ecosystem: p.ecosystem },
      })),
    };

    const res = await fetch(`${OSV_API}/querybatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OSV API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { results: Array<{ vulns?: OsvVuln[] }> };

    for (let j = 0; j < batch.length; j++) {
      const pkg = batch[j];
      const vulns = data.results[j]?.vulns ?? [];
      if (pkg) {
        results.push({ name: pkg.name, version: pkg.version, ecosystem: pkg.ecosystem, vulns });
      }
    }
  }

  return results;
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
