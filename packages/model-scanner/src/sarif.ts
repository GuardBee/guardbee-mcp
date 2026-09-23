import type { Finding } from "./scanner.js";

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri?: string;
  properties: { "problem.severity": string; tags: string[] };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId: string };
      region: { startLine: number; startColumn: number };
    };
  }>;
}

function severityToLevel(sev: string): "error" | "warning" | "note" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "note";
}

export function buildSarif(toolVersion: string, findings: Finding[]): object {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const f of findings) {
    if (!rulesMap.has(f.patternId)) {
      rulesMap.set(f.patternId, {
        id: f.patternId,
        name: f.patternName.replace(/[^a-zA-Z0-9]/g, ""),
        shortDescription: { text: f.patternName },
        fullDescription: { text: f.recommendation },
        helpUri: "https://guardbee.ai/docs/model-scanner",
        properties: {
          "problem.severity": f.severity,
          tags: ["security", "ai-security", "supply-chain", f.category],
        },
      });
    }

    const result: SarifResult = {
      ruleId: f.patternId,
      level: severityToLevel(f.severity),
      message: { text: f.match ? `${f.patternName} — ${f.match} — ${f.recommendation}` : `${f.patternName} — ${f.recommendation}` },
    };

    if (f.file) {
      result.locations = [
        {
          physicalLocation: {
            artifactLocation: { uri: f.file, uriBaseId: "%SRCROOT%" },
            region: { startLine: f.line, startColumn: f.column },
          },
        },
      ];
    }

    results.push(result);
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "@guardbee/mcp-model-scanner",
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
