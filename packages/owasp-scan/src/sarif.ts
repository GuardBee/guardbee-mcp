import type { NormalizedFinding } from "./types.js";

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

/**
 * `fallbackUri` anchors findings that have no file of their own (toxic-flow
 * combinations, catalog/live results) — GitHub code scanning rejects results
 * without a location.
 */
export function buildSarif(toolVersion: string, findings: NormalizedFinding[], fallbackUri?: string): object {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const f of findings) {
    const ruleId = `${f.source}:${f.patternId}`;
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: f.patternName.replace(/[^a-zA-Z0-9]/g, ""),
        shortDescription: { text: f.patternName },
        fullDescription: { text: f.recommendation },
        helpUri: "https://guardbee.ai/docs/owasp-scan",
        properties: {
          "problem.severity": f.severity,
          tags: ["security", "ai-security", "mcp-security", f.owasp, f.source],
        },
      });
    }

    const result: SarifResult = {
      ruleId,
      level: severityToLevel(f.severity),
      message: { text: `${f.patternName} [${f.owasp}] — ${f.recommendation}` },
    };
    const uri = f.file ?? fallbackUri;
    if (uri) {
      result.locations = [
        {
          physicalLocation: {
            artifactLocation: { uri, uriBaseId: "%SRCROOT%" },
            region: { startLine: f.line ?? 1, startColumn: f.column ?? 1 },
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
            name: "@guardbee/mcp-owasp-scan",
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
