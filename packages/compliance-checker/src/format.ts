import type { Scan, Finding, ListResult } from "./client.js";
import type { Framework, Requirement } from "./frameworks.js";

const SEV_ICON: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🔵",
  INFO: "⚪",
};

export function formatComplianceScan(scan: Scan, framework: Framework): string {
  const lines = [
    `${framework} Compliance Scan`,
    `  Scan ID : ${scan.id}`,
    `  URL     : ${scan.url}`,
    `  Status  : ${scan.status}`,
    `  Score   : ${scan.score !== null ? scan.score + "/100" : "pending"}`,
  ];

  if (scan.summary) {
    const s = scan.summary;
    const totalIssues = s.critical + s.high + s.medium + s.low;
    lines.push(`  Issues  : ${totalIssues} (🔴 ${s.critical} critical  🟠 ${s.high} high  🟡 ${s.medium} medium  🔵 ${s.low} low)`);
  }

  if (scan.modules?.length) {
    lines.push("", "Module Results:");
    for (const m of scan.modules) {
      const icon = m.status === "PASSED" ? "✅" : m.status === "FAILED" ? "❌" : m.status === "WARN" ? "⚠️ " : "—";
      lines.push(`  ${icon}  ${m.moduleName ?? m.moduleId}${m.summary ? `  — ${m.summary}` : ""}`);
    }
  }

  return lines.join("\n");
}

export function formatFindings(findings: ListResult<Finding>, framework: Framework): string {
  if (findings.data.length === 0) {
    return `✅ No ${framework} compliance findings — all checks passed.`;
  }

  const lines = [
    `${framework} Findings (${findings.pagination.total} total)`,
    "─".repeat(60),
  ];

  for (let i = 0; i < findings.data.length; i++) {
    const f = findings.data[i]!;
    const icon = SEV_ICON[f.severity] ?? "•";
    lines.push(`${i + 1}. ${icon} [${f.severity}] ${f.title}`);
    if (f.description) lines.push(`   ${f.description}`);
    if (f.recommendation) lines.push(`   ✏️  Fix: ${f.recommendation}`);
    if (f.documentationUrl) lines.push(`   📖 ${f.documentationUrl}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatRequirementsReport(requirements: Requirement[], foundModuleIds: Set<string>): string {
  const lines: string[] = [];

  const byFramework = new Map<Framework, Requirement[]>();
  for (const req of requirements) {
    const list = byFramework.get(req.framework) ?? [];
    list.push(req);
    byFramework.set(req.framework, list);
  }

  for (const [fw, reqs] of byFramework) {
    lines.push(`${fw} Requirements:`);
    for (const req of reqs) {
      const covered = foundModuleIds.has(req.id);
      const icon = covered ? "✅" : req.severity === "critical" ? "🔴" : req.severity === "high" ? "🟠" : "🟡";
      lines.push(`  ${icon}  ${req.title}${req.legalBasis ? `  (${req.legalBasis})` : ""}`);
      if (!covered) lines.push(`       └─ ${req.description}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatGapAnalysis(
  requirements: Requirement[],
  scanFindings: Finding[],
  framework: Framework
): string {
  const findingModuleIds = new Set(scanFindings.map((f) => f.moduleId));
  const failingModuleIds = new Set(scanFindings.map((f) => f.moduleId));

  const lines = [
    `${framework} Gap Analysis`,
    "─".repeat(60),
  ];

  const gaps = requirements
    .filter((r) => r.framework === framework)
    .map((req) => {
      const findings = scanFindings.filter((f) => f.moduleId === req.id || req.id.includes(f.moduleId));
      return { req, findings, hasGap: findings.length > 0 };
    });

  const gapCount = gaps.filter((g) => g.hasGap).length;
  const passCount = gaps.length - gapCount;

  lines.push(`  ${passCount}/${gaps.length} requirements met  |  ${gapCount} gap(s) identified`);
  lines.push("");

  for (const { req, findings, hasGap } of gaps) {
    if (hasGap) {
      lines.push(`🔴 GAP: ${req.title}  (${req.legalBasis ?? req.category})`);
      lines.push(`   ${req.description}`);
      for (const f of findings.slice(0, 2)) {
        lines.push(`   Finding: [${f.severity}] ${f.title}`);
        if (f.recommendation) lines.push(`   Fix    : ${f.recommendation}`);
      }
      lines.push("");
    } else {
      lines.push(`✅  ${req.title}`);
    }
  }

  return lines.join("\n");
}

export function formatActionPlan(requirements: Requirement[], findings: Finding[]): string {
  const findingsBySeverity = {
    CRITICAL: findings.filter((f) => f.severity === "CRITICAL"),
    HIGH: findings.filter((f) => f.severity === "HIGH"),
    MEDIUM: findings.filter((f) => f.severity === "MEDIUM"),
    LOW: findings.filter((f) => f.severity === "LOW"),
  };

  const lines = ["Compliance Action Plan", "─".repeat(60)];

  if (findingsBySeverity.CRITICAL.length > 0) {
    lines.push(`\n🔴 IMMEDIATE ACTION REQUIRED (${findingsBySeverity.CRITICAL.length} critical issues):`);
    for (const f of findingsBySeverity.CRITICAL) {
      lines.push(`  • ${f.title}`);
      if (f.recommendation) lines.push(`    → ${f.recommendation}`);
    }
  }

  if (findingsBySeverity.HIGH.length > 0) {
    lines.push(`\n🟠 SHORT-TERM (${findingsBySeverity.HIGH.length} high issues — fix within 30 days):`);
    for (const f of findingsBySeverity.HIGH) {
      lines.push(`  • ${f.title}`);
      if (f.recommendation) lines.push(`    → ${f.recommendation}`);
    }
  }

  if (findingsBySeverity.MEDIUM.length > 0) {
    lines.push(`\n🟡 MEDIUM-TERM (${findingsBySeverity.MEDIUM.length} medium issues — fix within 90 days):`);
    for (const f of findingsBySeverity.MEDIUM.slice(0, 5)) {
      lines.push(`  • ${f.title}`);
    }
    if (findingsBySeverity.MEDIUM.length > 5) {
      lines.push(`  ... and ${findingsBySeverity.MEDIUM.length - 5} more`);
    }
  }

  if (Object.values(findingsBySeverity).every((arr) => arr.length === 0)) {
    lines.push("\n✅ No compliance gaps detected. Keep up the good work!");
  }

  return lines.join("\n");
}
