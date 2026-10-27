import { getSeverity, getFixedVersion, isMalicious } from "./osv.js";
import { planUpgrade } from "./fix.js";
import type { AuditResult, OsvVuln } from "./osv.js";

const MALWARE_ACTION =
  "Remove this version now. Treat every machine and CI runner that installed it as compromised and rotate the credentials it could reach.";

function detailsUrl(vuln: OsvVuln): string {
  const cve = (vuln.aliases ?? []).find((a) => a.startsWith("CVE-"));
  // MAL-* entries rarely have an NVD page; OSV shows the malware analysis.
  return cve && !isMalicious(vuln)
    ? `https://nvd.nist.gov/vuln/detail/${cve}`
    : `https://osv.dev/vulnerability/${vuln.id}`;
}

function finding(result: AuditResult, vuln: OsvVuln): string[] {
  const malicious = isMalicious(vuln);
  const fixed = getFixedVersion(vuln, result.name, result.version, result.ecosystem);
  const otherIds = (vuln.aliases ?? []).filter((a) => /^(CVE|GHSA|MAL|PYSEC)-/.test(a)).join(", ");
  const lines = [
    malicious
      ? `🚨 [MALICIOUS] ${result.name}@${result.version}`
      : `[${getSeverity(vuln).toUpperCase()}] ${result.name}@${result.version}`,
    `  ID      : ${vuln.id}${otherIds ? ` (${otherIds})` : ""}`,
    `  Summary : ${vuln.summary ?? "No summary available"}`,
  ];
  if (malicious) lines.push(`  Action  : ${MALWARE_ACTION}`);
  const { kev, epss } = vuln.exploit ?? {};
  if (kev) {
    lines.push(
      `  Exploited: CISA KEV since ${kev.dateAdded} (${kev.cve})${kev.ransomware ? ", used in ransomware campaigns" : ""}`
    );
  }
  if (epss) lines.push(`  EPSS    : ${formatEpss(epss.score, epss.percentile)}`);
  if (fixed) lines.push(`  Fix     : upgrade to ${result.name}@${fixed}`);
  if (result.path) lines.push(`  Path    : ${formatPath(result.path)}`);
  lines.push(`  Details : ${detailsUrl(vuln)}`, "");
  return lines;
}

export function formatEpss(score: number, percentile: number): string {
  const top = Math.max((1 - percentile) * 100, 0.1);
  // Truncate, not round: 0.99999 must not read as a certain 100.0%.
  const pct = (Math.floor(score * 1000) / 10).toFixed(1);
  return `${pct}% chance of exploitation in the next 30 days (top ${top < 1 ? top.toFixed(1) : Math.round(top)}% of CVEs)`;
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 } as const;

/**
 * Fix order: malware, then CVEs exploited in the wild (KEV), then severity,
 * then the likelihood of exploitation (EPSS).
 */
export function priority(vuln: OsvVuln): [number, number, number, number] {
  return [
    isMalicious(vuln) ? 0 : 1,
    vuln.exploit?.kev ? 0 : 1,
    SEVERITY_ORDER[getSeverity(vuln)],
    -(vuln.exploit?.epss?.score ?? 0),
  ];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** `express@4.21.2 › body-parser@1.20.3 › qs@6.13.0`, or "direct dependency". */
export function formatPath(path: string[]): string {
  return path.length <= 1 ? "direct dependency" : path.join(" › ");
}

/** `log4j-core 2.14.1 → 2.17.1 (fixes 7/7)` — one line per vulnerable package, most urgent first. */
export function fixPlan(results: AuditResult[]): string[] {
  const vulnerable = results.filter((r) => r.vulns.length > 0);
  if (vulnerable.length === 0) return [];
  const urgency = (r: AuditResult) => r.vulns.map(priority).sort(compare)[0]!;
  const lines = [...vulnerable]
    .sort((a, b) => compare(urgency(a), urgency(b)))
    .map((r) => planLine(r) + (r.path && r.path.length > 1 ? `  ← via ${r.path[0]}` : ""));
  return ["🛠  Fix plan — one upgrade per package:", ...lines, ""];
}

function planLine(r: AuditResult): string {
  const plan = planUpgrade(r);
  const head = `   ${r.name} ${r.version} → `;
  if (r.vulns.some(isMalicious)) {
    return plan.version
      ? `${head}remove now (known-malicious), then pin ${plan.version} or later`
      : `${head}remove now (known-malicious; no clean version listed)`;
  }
  if (!plan.version) {
    return `${head}no fixed version listed (${r.vulns.length} advisor${r.vulns.length === 1 ? "y" : "ies"})`;
  }
  const open = plan.unfixed.length > 0 ? `; still open: ${plan.unfixed.join(", ")}` : "";
  const major = plan.major ? ", major upgrade: check for breaking changes" : "";
  return `${head}${plan.version}  (fixes ${plan.fixes}/${plan.total}${major}${open})`;
}

/** Human-readable audit report shared by the CLI and the MCP tools. */
export function formatReport(
  results: AuditResult[],
  label: string,
  durationMs: number,
  notes: string[] = []
): string {
  const vulnerable = results.filter((r) => r.vulns.length > 0);
  const total = vulnerable.reduce((s, r) => s + r.vulns.length, 0);

  if (total === 0) {
    return [`✅ No known vulnerabilities found in ${results.length} ${label} packages (${durationMs}ms).`, ...notes].join("\n");
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  let malicious = 0;
  let exploited = 0;
  for (const r of vulnerable) {
    for (const v of r.vulns) {
      counts[getSeverity(v)]++;
      if (isMalicious(v)) malicious++;
      if (v.exploit?.kev) exploited++;
    }
  }

  const lines: string[] = [];
  if (malicious > 0) {
    lines.push(
      `🚨 ${malicious} known-malicious package version${malicious === 1 ? "" : "s"} installed — see the top of this report.`
    );
  }
  if (exploited > 0) {
    lines.push(
      `🔥 ${exploited} finding${exploited === 1 ? " is" : "s are"} exploited in the wild (CISA KEV) — fix ${exploited === 1 ? "it" : "them"} first.`
    );
  }
  lines.push(
    `⚠️  Found ${total} vulnerabilit${total === 1 ? "y" : "ies"} in ${vulnerable.length}/${results.length} ${label} packages (${durationMs}ms)`,
    `   Critical: ${counts.critical}  High: ${counts.high}  Medium: ${counts.medium}  Low: ${counts.low}  Unknown: ${counts.unknown}` +
      (malicious > 0 ? `  (Malicious: ${malicious})` : ""),
    ""
  );

  lines.push(...fixPlan(results));

  const ordered = vulnerable
    .flatMap((r) => r.vulns.map((v) => ({ r, v })))
    .sort((a, b) => compare(priority(a.v), priority(b.v)));
  for (const { r, v } of ordered) lines.push(...finding(r, v));

  return [...lines, ...notes].join("\n");
}
