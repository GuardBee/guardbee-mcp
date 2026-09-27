import type { ConfigFinding } from "./types.js";

function severityToLevel(severity: string): "error" | "warning" | "note" {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "note";
}

export function buildSarif(toolVersion: string, findings: ConfigFinding[]): object {
  const rules = new Map<string, object>();
  const results = [];

  for (const finding of findings) {
    if (!rules.has(finding.patternId)) {
      rules.set(finding.patternId, {
        id: finding.patternId,
        shortDescription: { text: finding.patternName },
        fullDescription: { text: finding.recommendation },
        helpUri: "https://guardbee.ai/docs/mcp-config-auditor",
        properties: {
          "problem.severity": finding.severity,
          tags: ["security", "mcp-security", finding.category, finding.owasp],
        },
      });
    }
    results.push({
      ruleId: finding.patternId,
      level: severityToLevel(finding.severity),
      message: { text: `${finding.patternName} — ${finding.recommendation}` },
      locations: finding.file
        ? [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file, uriBaseId: "%SRCROOT%" },
                region: { startLine: finding.line, startColumn: finding.column },
              },
            },
          ]
        : undefined,
    });
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "@guardbee/mcp-config-auditor",
            version: toolVersion,
            informationUri: "https://guardbee.ai",
            rules: Array.from(rules.values()),
          },
        },
        results,
      },
    ],
  };
}
