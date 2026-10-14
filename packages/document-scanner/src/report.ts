import type { DocumentResult, Finding } from "./scanner.js";

const RANK: Record<Finding["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Human-readable report, the same for the MCP tools and the CLI. */
export function formatResults(documents: DocumentResult[], durationMs?: number): string {
  const findings = documents.flatMap((d) => d.findings);
  const lines: string[] = [];
  const timing = durationMs !== undefined ? ` (${durationMs}ms)` : "";
  if (findings.length === 0) lines.push(`✅ No PII or credentials found in ${documents.length} document(s)${timing}.`);
  else {
    const count = (s: Finding["severity"]) => findings.filter((f) => f.severity === s).length;
    lines.push(`⚠️  Found ${findings.length} item(s) in ${documents.length} document(s)${timing}`);
    lines.push(`   Critical: ${count("critical")}  High: ${count("high")}  Medium: ${count("medium")}  Low: ${count("low")}`);
  }
  for (const doc of documents) {
    if (doc.findings.length === 0 && doc.notes.length === 0) continue;
    lines.push("", `${doc.location} (${doc.kind}, ${doc.pagesRead} page(s) read)`);
    for (const f of [...doc.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.page - b.page)) {
      lines.push(`  [${f.severity.toUpperCase()}] ${f.detector} (${f.category}) — page ${f.page}, ${f.method}: ${f.maskedMatch}`);
    }
    for (const note of doc.notes) lines.push(`  note: ${note}`);
  }
  return lines.join("\n");
}

export function shouldFail(findings: Finding[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const threshold = RANK[failOn as Finding["severity"]] ?? RANK.high;
  return findings.some((f) => RANK[f.severity] <= threshold);
}

/** SARIF 2.1.0 for code-scanning uploads; a page goes in the region's startLine. */
export function buildSarif(version: string, findings: Finding[]): object {
  const rules = [...new Set(findings.map((f) => f.detector))].map((id) => ({
    id,
    name: id.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase()),
    shortDescription: { text: `${id} in a document` },
    helpUri: "https://github.com/GuardBee/guardbee-mcp/tree/main/packages/document-scanner",
    properties: { tags: ["security", "pii", "dlp", findings.find((f) => f.detector === id)!.category] },
  }));
  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "@guardbee/mcp-document-scanner", version, informationUri: "https://guardbee.ai", rules } },
        results: findings.map((f) => ({
          ruleId: f.detector,
          level: f.severity === "critical" || f.severity === "high" ? "error" : f.severity === "medium" ? "warning" : "note",
          message: { text: `${f.detector} (${f.maskedMatch}) on page ${f.page}, read by ${f.method}` },
          locations: [{ physicalLocation: { artifactLocation: { uri: f.location, uriBaseId: "%SRCROOT%" }, region: { startLine: f.page } } }],
        })),
      },
    ],
  };
}
