import type { TlsInspectResult, Finding } from "./inspector.js";

// ── SARIF 2.1.0 types (minimal) ───────────────────────────────────────────────

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  helpUri?: string;
  properties: { "problem.severity": string; tags: string[] };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
    };
  }>;
}

function severityToLevel(sev: string): "error" | "warning" | "note" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "note";
}

const HELP_URLS: Record<string, string> = {
  CERT_EXPIRED: "https://guardbee.ai/docs/ssl#cert-expired",
  CERT_EXPIRY_CRITICAL: "https://guardbee.ai/docs/ssl#cert-expiry",
  CERT_EXPIRY_SOON: "https://guardbee.ai/docs/ssl#cert-expiry",
  CERT_EXPIRY_WARN: "https://guardbee.ai/docs/ssl#cert-expiry",
  CERT_CHAIN_INVALID: "https://guardbee.ai/docs/ssl#cert-chain",
  DEPRECATED_PROTOCOL: "https://guardbee.ai/docs/ssl#protocol",
  OBSOLETE_PROTOCOL: "https://guardbee.ai/docs/ssl#protocol",
  WEAK_CIPHER: "https://guardbee.ai/docs/ssl#cipher",
  NO_HSTS: "https://guardbee.ai/docs/ssl#hsts",
};

export function buildSarif(toolVersion: string, results: TlsInspectResult[]): object {
  const rulesMap = new Map<string, SarifRule>();
  const sarifResults: SarifResult[] = [];

  for (const r of results) {
    const hostUri = `https://${r.host}:${r.port}/`;

    for (const f of r.findings) {
      if (f.code === "OK") continue;

      if (!rulesMap.has(f.code)) {
        rulesMap.set(f.code, {
          id: f.code,
          name: f.code.replace(/_/g, ""),
          shortDescription: { text: f.message },
          helpUri: HELP_URLS[f.code] ?? "https://guardbee.ai/docs/ssl",
          properties: {
            "problem.severity": f.severity,
            tags: ["security", "tls", "certificate"],
          },
        });
      }

      sarifResults.push({
        ruleId: f.code,
        level: severityToLevel(f.severity),
        message: { text: `${r.host}: ${f.message}` },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: hostUri },
            },
          },
        ],
      });
    }
  }

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "@guardbee/mcp-ssl-inspector",
            version: toolVersion,
            informationUri: "https://guardbee.ai",
            rules: Array.from(rulesMap.values()),
          },
        },
        results: sarifResults,
      },
    ],
  };
}
