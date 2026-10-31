import { fetchWithRetry, type Fetch } from "./http.js";

export interface KnownIssue {
  id: string;
  /** MAL-* advisories: the package is malware. */
  malicious: boolean;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  summary?: string;
}

interface OsvVuln {
  id: string;
  summary?: string;
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
}

/** CVSS v3 base score from a vector string, for advisories that carry no severity label. */
function cvss3(vector: string): number | undefined {
  const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":")));
  const W: Record<string, Record<string, number>> = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    C: { H: 0.56, L: 0.22, N: 0 },
    I: { H: 0.56, L: 0.22, N: 0 },
    A: { H: 0.56, L: 0.22, N: 0 },
  };
  const changed = m["S"] === "C";
  const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m["PR"] as "N" | "L" | "H"];
  const parts = [W["AV"]![m["AV"]!], W["AC"]![m["AC"]!], pr, W["UI"]![m["UI"]!], W["C"]![m["C"]!], W["I"]![m["I"]!], W["A"]![m["A"]!]];
  if (parts.some((p) => p === undefined)) return undefined;
  const [av, ac, prv, ui, c, i, a] = parts as number[];
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av! * ac! * prv! * ui!;
  const roundUp = (x: number) => Math.ceil(x * 10) / 10;
  return roundUp(Math.min(changed ? 1.08 * (impact + exploitability) : impact + exploitability, 10));
}

function severityOf(vuln: OsvVuln): KnownIssue["severity"] {
  const label = vuln.database_specific?.severity?.toLowerCase();
  if (label === "critical" || label === "high" || label === "low") return label;
  if (label === "moderate" || label === "medium") return "medium";
  const vector = vuln.severity?.find((s) => s.type === "CVSS_V3")?.score;
  const score = vector ? cvss3(vector) : undefined;
  if (score === undefined) return "unknown";
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";
}

/** Advisories (OSV.dev, which includes GHSA and the OpenSSF malicious-packages feed) for one package version. */
export async function knownIssues(fetchFn: Fetch, ecosystem: "npm" | "pypi", name: string, version: string): Promise<KnownIssue[]> {
  const body = JSON.stringify({ package: { name, ecosystem: ecosystem === "npm" ? "npm" : "PyPI" }, version });
  const response = await fetchWithRetry(fetchFn, "https://api.osv.dev/v1/query", { method: "POST", body, headers: { "content-type": "application/json" } });
  if (!response.ok) throw new Error(`OSV HTTP ${response.status}`);
  const result = (await response.json()) as { vulns?: OsvVuln[] };
  return (result.vulns ?? []).map((v) => ({ id: v.id, malicious: v.id.startsWith("MAL-"), severity: severityOf(v), ...(v.summary ? { summary: v.summary } : {}) }));
}

