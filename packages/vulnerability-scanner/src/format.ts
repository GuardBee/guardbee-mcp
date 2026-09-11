import type { Scan, Finding, ListResult, ScanSummary } from "./client.js";

const SEV_ICON: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🔵",
  INFO: "⚪",
};

const STATUS_ICON: Record<string, string> = {
  PENDING: "⏳",
  RUNNING: "🔄",
  COMPLETED: "✅",
  FAILED: "❌",
  CANCELLED: "⛔",
};

export function formatScan(scan: Scan): string {
  const lines: string[] = [
    `Scan ${scan.id}`,
    `  URL     : ${scan.url}`,
    `  Status  : ${STATUS_ICON[scan.status] ?? ""} ${scan.status}`,
    `  Score   : ${scan.score !== null ? scan.score + "/100" : "pending"}`,
    `  Created : ${scan.createdAt}`,
    scan.finishedAt ? `  Finished: ${scan.finishedAt}` : "",
  ].filter(Boolean);

  if (scan.summary) {
    const s = scan.summary;
    lines.push(
      `  Summary : 🔴 ${s.critical} critical  🟠 ${s.high} high  🟡 ${s.medium} medium  🔵 ${s.low} low  ⚪ ${s.info} info  ✅ ${s.passed} passed`
    );
  }

  return lines.join("\n");
}

export function formatScanList(result: ListResult<Scan>): string {
  if (result.data.length === 0) return "No scans found.";

  const lines: string[] = [
    `Scans (${result.pagination.total} total, page ${result.pagination.page}/${result.pagination.totalPages})`,
    "─".repeat(70),
  ];

  for (const scan of result.data) {
    const icon = STATUS_ICON[scan.status] ?? "";
    const score = scan.score !== null ? `score=${scan.score}` : "pending";
    lines.push(`${icon} ${scan.id}  ${scan.url}  ${score}  ${scan.createdAt.slice(0, 10)}`);
  }

  return lines.join("\n");
}

export function formatFinding(f: Finding, index?: number): string {
  const icon = SEV_ICON[f.severity] ?? "•";
  const num = index !== undefined ? `${index + 1}. ` : "";
  const lines = [
    `${num}${icon} [${f.severity}] ${f.title}`,
    `   Module  : ${f.moduleId}`,
    f.cveId ? `   CVE     : ${f.cveId}` : "",
    f.description ? `   Details : ${f.description}` : "",
    f.recommendation ? `   Fix     : ${f.recommendation}` : "",
    f.documentationUrl ? `   Docs    : ${f.documentationUrl}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function formatFindingList(result: ListResult<Finding>, scanId?: string): string {
  const { data, pagination } = result;

  if (data.length === 0) {
    return scanId
      ? `No findings for scan ${scanId}.`
      : "No findings found.";
  }

  const header = scanId
    ? `Findings for scan ${scanId}`
    : "Findings";

  const lines: string[] = [
    `${header} (${pagination.total} total, page ${pagination.page}/${pagination.totalPages})`,
    "─".repeat(70),
  ];

  for (let i = 0; i < data.length; i++) {
    lines.push(formatFinding(data[i]!, i));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatSummary(summary: ScanSummary, url: string, scanId: string): string {
  const total = summary.critical + summary.high + summary.medium + summary.low + summary.info;
  if (total === 0) {
    return `✅ No vulnerabilities found for ${url} (scan ${scanId})`;
  }

  return [
    `⚠️  Security scan complete for ${url}`,
    `   Scan ID  : ${scanId}`,
    `   🔴 Critical : ${summary.critical}`,
    `   🟠 High     : ${summary.high}`,
    `   🟡 Medium   : ${summary.medium}`,
    `   🔵 Low      : ${summary.low}`,
    `   ⚪ Info     : ${summary.info}`,
    `   ✅ Passed   : ${summary.passed}`,
    "",
    `Use get_findings with scanId="${scanId}" to see details and remediation steps.`,
  ].join("\n");
}
