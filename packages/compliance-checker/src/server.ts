import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { clientFromEnv, GuardBeeApiError } from "./client.js";
import { REQUIREMENTS, SCENARIO_MAP, getRequirements, type Framework } from "./frameworks.js";
import {
  formatComplianceScan,
  formatFindings,
  formatGapAnalysis,
  formatActionPlan,
} from "./format.js";
import {
  analyzePrivacyPolicyText,
  findPrivacyPolicyUrl,
  detectCookieBanner,
  formatPolicyAnalysis,
} from "./policy-analyzer.js";

const FRAMEWORK_ENUM = ["KVKK", "GDPR", "CCPA"] as const;

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-compliance-checker",
    version: "0.1.0",
  });
  instrumentServer(server, "compliance-checker");

  // ── check_compliance ────────────────────────────────────────────────────────

  server.tool(
    "check_compliance",
    "Run a full compliance scan for a URL against a regulatory framework (KVKK, GDPR, or CCPA) using the GuardBee scanner. Returns a gap analysis and action plan.",
    {
      url: z.string().url().describe("Target URL to audit for compliance"),
      framework: z.enum(FRAMEWORK_ENUM).describe("Regulatory framework: KVKK, GDPR, or CCPA"),
      wait: z.boolean().optional().describe("Wait for scan to complete (default: true)"),
    },
    async ({ url, framework, wait = true }) => {
      try {
        const client = clientFromEnv();
        const scenario = SCENARIO_MAP[framework as Framework];
        const scan = await client.createScan({ url, scenario });

        if (!wait) {
          return {
            content: [{
              type: "text",
              text: [
                `✅ ${framework} compliance scan started`,
                `   Scan ID : ${scan.id}`,
                `   URL     : ${url}`,
                ``,
                `Use get_compliance_status with scanId="${scan.id}" to check progress.`,
                `Use get_compliance_findings with scanId="${scan.id}" once complete.`,
              ].join("\n"),
            }],
          };
        }

        const completed = await client.waitForScan(scan.id);
        const findings = await client.listFindings({ scanId: scan.id, pageSize: 100 });
        const requirements = getRequirements([framework as Framework]);

        const parts = [
          formatComplianceScan(completed, framework as Framework),
          "",
          formatGapAnalysis(requirements, findings.data, framework as Framework),
          "",
          formatActionPlan(requirements, findings.data),
        ];

        return { content: [{ type: "text", text: parts.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    }
  );

  // ── get_compliance_findings ─────────────────────────────────────────────────

  server.tool(
    "get_compliance_findings",
    "Get compliance findings from a completed GuardBee scan, optionally filtered by severity",
    {
      scanId: z.string().describe("Scan ID from check_compliance or start_scan"),
      framework: z.enum(FRAMEWORK_ENUM).optional().describe("Framework label for the report header"),
      severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]).optional().describe("Filter by severity"),
    },
    async ({ scanId, framework = "GDPR", severity }) => {
      try {
        const client = clientFromEnv();
        const findings = await client.listFindings({
          scanId,
          severity,
          pageSize: 100,
        });
        return { content: [{ type: "text", text: formatFindings(findings, framework as Framework) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    }
  );

  // ── analyze_privacy_policy ──────────────────────────────────────────────────

  server.tool(
    "analyze_privacy_policy",
    "Fetch and analyze a privacy policy page for completeness against GDPR/KVKK requirements. Works without an API key.",
    {
      url: z.string().url().describe("Direct URL to the privacy policy page (or homepage to auto-detect)"),
    },
    async ({ url }) => {
      try {
        // Fetch the page
        const res = await fetch(url, {
          headers: { "User-Agent": "GuardBee-Compliance-Checker/0.1 (privacy policy analysis)" },
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          return {
            content: [{
              type: "text",
              text: `Cannot fetch ${url}: HTTP ${res.status}`,
            }],
          };
        }

        const html = await res.text();

        // Try to find privacy policy link if this is a homepage
        const detectedUrl = findPrivacyPolicyUrl(html, url);
        let policyText = html;
        let analysisUrl = url;

        if (detectedUrl && detectedUrl !== url) {
          try {
            const policyRes = await fetch(detectedUrl, {
              headers: { "User-Agent": "GuardBee-Compliance-Checker/0.1" },
              signal: AbortSignal.timeout(15_000),
            });
            if (policyRes.ok) {
              policyText = await policyRes.text();
              analysisUrl = detectedUrl;
            }
          } catch {
            // fall through to analyzing original page
          }
        }

        // Strip HTML tags for text analysis
        const text = policyText
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

        const analysis = analyzePrivacyPolicyText(analysisUrl, text);
        const cookieBanner = detectCookieBanner(html);

        const lines = [formatPolicyAnalysis(analysis)];

        lines.push("");
        lines.push("Cookie Consent Banner:");
        if (cookieBanner.detected) {
          lines.push(`  ✅ Detected (signals: ${cookieBanner.signals.join(", ")})`);
        } else {
          lines.push("  ❌ Not detected — cookie consent banner may be missing");
        }

        if (detectedUrl && detectedUrl !== url) {
          lines.push(`\n(Privacy policy auto-detected at: ${detectedUrl})`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: `Error analyzing ${url}: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  // ── list_requirements ───────────────────────────────────────────────────────

  server.tool(
    "list_requirements",
    "List all compliance requirements for a framework with legal basis references",
    {
      framework: z.enum(FRAMEWORK_ENUM).describe("Framework: KVKK, GDPR, or CCPA"),
      severity: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("Filter by severity"),
    },
    async ({ framework, severity }) => {
      let reqs = getRequirements([framework as Framework]);
      if (severity) reqs = reqs.filter((r) => r.severity === severity);

      const lines = [
        `${framework} Requirements (${reqs.length})`,
        "─".repeat(60),
      ];

      const byCategory = new Map<string, typeof reqs>();
      for (const req of reqs) {
        const list = byCategory.get(req.category) ?? [];
        list.push(req);
        byCategory.set(req.category, list);
      }

      for (const [cat, catReqs] of byCategory) {
        lines.push(`\n${cat}:`);
        for (const req of catReqs) {
          const icon = req.severity === "critical" ? "🔴" : req.severity === "high" ? "🟠" : req.severity === "medium" ? "🟡" : "🔵";
          lines.push(`  ${icon}  ${req.title}${req.legalBasis ? `  (${req.legalBasis})` : ""}`);
          lines.push(`       ${req.description}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // ── compare_frameworks ──────────────────────────────────────────────────────

  server.tool(
    "compare_frameworks",
    "Compare KVKK, GDPR, and CCPA requirements side by side to understand overlaps and gaps",
    {},
    async () => {
      const lines = [
        "Regulatory Framework Comparison",
        "─".repeat(70),
        "",
        "Topic".padEnd(32) + "KVKK".padEnd(12) + "GDPR".padEnd(12) + "CCPA",
        "─".repeat(70),
      ];

      const topics: Array<{ label: string; kvkk: string; gdpr: string; ccpa: string }> = [
        { label: "Privacy notice/policy", kvkk: "Required", gdpr: "Required", ccpa: "Required" },
        { label: "Cookie consent (prior)", kvkk: "Required", gdpr: "Required", ccpa: "Opt-out only" },
        { label: "Legal basis disclosure", kvkk: "Partial", gdpr: "Required", ccpa: "N/A" },
        { label: "Data subject rights", kvkk: "8 rights", gdpr: "8 rights", ccpa: "5 rights" },
        { label: "DPO appointment", kvkk: "Optional", gdpr: "Conditional", ccpa: "N/A" },
        { label: "Retention periods", kvkk: "Required", gdpr: "Required", ccpa: "Partial" },
        { label: "Cross-border transfers", kvkk: "Art. 9", gdpr: "Art. 44-49", ccpa: "N/A" },
        { label: "Breach notification (72h)", kvkk: "72h (Board)", gdpr: "72h (DPA)", ccpa: "N/A" },
        { label: "Do Not Sell link", kvkk: "N/A", gdpr: "N/A", ccpa: "Required" },
        { label: "GPC signal support", kvkk: "N/A", gdpr: "N/A", ccpa: "Required (CA)" },
        { label: "Consent for children", kvkk: "Under 18", gdpr: "Under 16", ccpa: "Under 16" },
        { label: "Registration/notification", kvkk: "VERBİS", gdpr: "No (post-2018)", ccpa: "AG filing" },
        { label: "Max fine", kvkk: "₺9.38M / art.", gdpr: "€20M / 4% revenue", ccpa: "$7,500/violation" },
      ];

      for (const t of topics) {
        lines.push(
          t.label.padEnd(32) + t.kvkk.padEnd(12) + t.gdpr.padEnd(12) + t.ccpa
        );
      }

      lines.push("", "─".repeat(70));
      lines.push("Use list_requirements to see detailed requirements per framework.");

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message.includes("GUARDBEE_API_KEY")) {
    return [
      "❌ API key not configured.",
      "",
      "Set your GuardBee API key:",
      '  export GUARDBEE_API_KEY="gb_..."',
      "",
      "Get your API key from: https://app.guardbee.ai/developers",
      "",
      "Note: analyze_privacy_policy and list_requirements work without an API key.",
    ].join("\n");
  }
  if (err instanceof GuardBeeApiError) {
    return `❌ GuardBee API error (${err.status}): ${err.message}${err.code ? ` [${err.code}]` : ""}`;
  }
  return `❌ Error: ${err instanceof Error ? err.message : String(err)}`;
}
