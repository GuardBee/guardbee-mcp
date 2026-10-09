import type { Finding } from "./analyzer.js";

function severityToLevel(sev: string): "error" | "warning" | "note" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "note";
}

export function buildSarif(toolVersion: string, findings: Finding[]): object {
  const rulesMap = new Map<string, object>();
  const results: object[] = [];

  for (const f of findings) {
    if (!rulesMap.has(f.patternId)) {
      rulesMap.set(f.patternId, {
        id: f.patternId,
        name: f.patternName.replace(/[^a-zA-Z0-9]/g, ""),
        shortDescription: { text: f.patternName },
        fullDescription: { text: f.recommendation },
        helpUri: "https://guardbee.ai/docs/toxic-flow-auditor",
        properties: {
          "problem.severity": f.severity,
          // category can itself be "toxic-flow"; SARIF rejects duplicate tags.
          tags: [...new Set(["security", "ai-security", "mcp-security", "toxic-flow", f.owasp, f.category])],
        },
      });
    }
    results.push({
      ruleId: f.patternId,
      level: severityToLevel(f.severity),
      message: { text: `${f.patternName} — ${f.recommendation}` },
      properties: { tools: f.tools, capabilities: f.capabilities },
    });
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "@guardbee/mcp-toxic-flow-auditor",
            version: toolVersion,
            informationUri: "https://guardbee.ai",
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
      },
    ],
  };
}
