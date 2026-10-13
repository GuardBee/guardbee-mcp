import { getSeverity, getFixedVersion, isMalicious } from "./osv.js";
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
  const fixed = getFixedVersion(vuln, result.name);
  const otherIds = (vuln.aliases ?? []).filter((a) => /^(CVE|GHSA|MAL|PYSEC)-/.test(a)).join(", ");
  const lines = [
    malicious
      ? `🚨 [MALICIOUS] ${result.name}@${result.version}`
      : `[${getSeverity(vuln).toUpperCase()}] ${result.name}@${result.version}`,
    `  ID      : ${vuln.id}${otherIds ? ` (${otherIds})` : ""}`,
    `  Summary : ${vuln.summary ?? "No summary available"}`,
  ];
  if (malicious) lines.push(`  Action  : ${MALWARE_ACTION}`);
  if (fixed) lines.push(`  Fix     : upgrade to ${result.name}@${fixed}`);
  lines.push(`  Details : ${detailsUrl(vuln)}`, "");
  return lines;
}

/** Human-readable audit report shared by the CLI and the MCP tools. */
export function formatReport(results: AuditResult[], label: string, durationMs: number): string {
  const vulnerable = results.filter((r) => r.vulns.length > 0);
  const total = vulnerable.reduce((s, r) => s + r.vulns.length, 0);

  if (total === 0) {
    return `✅ No known vulnerabilities found in ${results.length} ${label} packages (${durationMs}ms).`;
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  let malicious = 0;
  for (const r of vulnerable) {
    for (const v of r.vulns) {
      counts[getSeverity(v)]++;
      if (isMalicious(v)) malicious++;
    }
  }

  const lines: string[] = [];
  if (malicious > 0) {
    lines.push(
      `🚨 ${malicious} known-malicious package version${malicious === 1 ? "" : "s"} installed — see the top of this report.`
    );
  }
  lines.push(
    `⚠️  Found ${total} vulnerabilit${total === 1 ? "y" : "ies"} in ${vulnerable.length}/${results.length} ${label} packages (${durationMs}ms)`,
    `   Critical: ${counts.critical}  High: ${counts.high}  Medium: ${counts.medium}  Low: ${counts.low}  Unknown: ${counts.unknown}` +
      (malicious > 0 ? `  (Malicious: ${malicious})` : ""),
    ""
  );

  // Malware first: it needs action before any upgrade work.
  for (const pass of [true, false]) {
    for (const r of vulnerable) {
      for (const v of r.vulns) {
        if (isMalicious(v) === pass) lines.push(...finding(r, v));
      }
    }
  }

  return lines.join("\n");
}
