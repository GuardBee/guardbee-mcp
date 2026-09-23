import type { EndpointScanResult } from "./scanner.js";
import type { Finding } from "./types.js";

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

function severityToLevel(sev: Finding["severity"]): "error" | "warning" | "note" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "note";
}

export function buildSarif(toolVersion: string, result: EndpointScanResult): object {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const f of result.findings) {
    if (!rulesMap.has(f.code)) {
      rulesMap.set(f.code, {
        id: f.code,
        shortDescription: { text: f.message },
        fullDescription: { text: f.recommendation },
        helpUri: "https://guardbee.ai/docs/vector-store-scanner",
        properties: { "problem.severity": f.severity, tags: ["security", "ai-security", "exposure", result.detectedType] },
      });
    }

    results.push({
      ruleId: f.code,
      level: severityToLevel(f.severity),
      message: { text: `${f.message} — ${f.recommendation}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: result.target } } }],
    });
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "@guardbee/mcp-vector-store-scanner",
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
