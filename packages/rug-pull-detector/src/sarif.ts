interface SarifRule {
  id: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri?: string;
  properties: { "problem.severity": string; tags: string[] };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
}

function severityToLevel(sev: string): "error" | "warning" | "note" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "note";
}

export interface SarifFinding {
  patternId: string;
  patternName: string;
  severity: string;
  recommendation: string;
  detail: string;
  tags?: string[];
}

export function buildSarif(toolVersion: string, target: string, findings: SarifFinding[]): object {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const f of findings) {
    if (!rulesMap.has(f.patternId)) {
      rulesMap.set(f.patternId, {
        id: f.patternId,
        shortDescription: { text: f.patternName },
        fullDescription: { text: f.recommendation },
        helpUri: "https://guardbee.ai/docs/rug-pull-detector",
        properties: { "problem.severity": f.severity, tags: ["security", "mcp-security", "ai-security", ...(f.tags ?? ["rug-pull"])] },
      });
    }
    results.push({
      ruleId: f.patternId,
      level: severityToLevel(f.severity),
      message: { text: `${f.patternName} — ${f.recommendation}\n${f.detail}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: target } } }],
    });
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "@guardbee/mcp-rug-pull-detector",
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
