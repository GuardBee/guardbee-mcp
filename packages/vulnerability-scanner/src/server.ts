import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clientFromEnv, GuardBeeApiError, type Severity, type ScanStatus, type ScanScenario } from "./client.js";
import { formatScan, formatScanList, formatFindingList, formatSummary } from "./format.js";

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-vulnerability-scanner",
    version: "0.1.0",
  });

  // ── start_scan ──────────────────────────────────────────────────────────────

  server.tool(
    "start_scan",
    "Start a GuardBee security scan on a URL. Returns a scan ID you can use to check status and get findings.",
    {
      url: z.string().url().optional().describe("Target URL to scan (e.g. https://example.com)"),
      brandId: z.string().optional().describe("Brand ID from your GuardBee workspace (alternative to url)"),
      scenario: z
        .enum(["quick", "kvkkFocus", "gdprFocus", "ccpaFocus"])
        .optional()
        .describe("Scan scenario: 'quick' (all modules), 'kvkkFocus', 'gdprFocus', 'ccpaFocus'"),
      wait: z
        .boolean()
        .optional()
        .describe("Wait for scan to complete and return summary (default: false). Warning: scans can take minutes."),
    },
    async ({ url, brandId, scenario, wait = false }) => {
      try {
        const client = clientFromEnv();
        const scan = await client.createScan({
          url,
          brandId,
          scenario: scenario as ScanScenario | undefined,
        });

        if (!wait) {
          return {
            content: [{
              type: "text",
              text: [
                `✅ Scan started!`,
                `   ID     : ${scan.id}`,
                `   URL    : ${scan.url ?? "(brand scan)"}`,
                `   Status : ${scan.status}`,
                ``,
                `Use get_scan_status with scanId="${scan.id}" to check progress.`,
                `Use get_findings with scanId="${scan.id}" once complete to see results.`,
              ].join("\n"),
            }],
          };
        }

        // Wait for completion
        const completed = await client.waitForScan(scan.id, { maxWaitMs: 600_000 });
        if (!completed.summary) {
          return { content: [{ type: "text", text: formatScan(completed) }] };
        }

        return {
          content: [{
            type: "text",
            text: formatSummary(completed.summary, completed.url, completed.id),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    }
  );

  // ── get_scan_status ─────────────────────────────────────────────────────────

  server.tool(
    "get_scan_status",
    "Get the current status and summary of a GuardBee scan by ID",
    {
      scanId: z.string().describe("Scan ID returned by start_scan"),
    },
    async ({ scanId }) => {
      try {
        const client = clientFromEnv();
        const scan = await client.getScan(scanId);
        return { content: [{ type: "text", text: formatScan(scan) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    }
  );

  // ── list_scans ──────────────────────────────────────────────────────────────

  server.tool(
    "list_scans",
    "List recent GuardBee scans in your workspace",
    {
      status: z
        .enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"])
        .optional()
        .describe("Filter by scan status"),
      brandId: z.string().optional().describe("Filter by brand ID"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 20, max: 50)"),
    },
    async ({ status, brandId, page, pageSize }) => {
      try {
        const client = clientFromEnv();
        const result = await client.listScans({
          status: status as ScanStatus | undefined,
          brandId,
          page,
          pageSize: Math.min(pageSize ?? 20, 50),
        });
        return { content: [{ type: "text", text: formatScanList(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    }
  );

  // ── get_findings ────────────────────────────────────────────────────────────

  server.tool(
    "get_findings",
    "Get vulnerability findings from a GuardBee scan with optional severity filter. Includes title, description, and remediation recommendation per finding.",
    {
      scanId: z.string().optional().describe("Filter by scan ID"),
      brandId: z.string().optional().describe("Filter by brand ID (gets findings across all scans for that brand)"),
      severity: z
        .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])
        .optional()
        .describe("Filter by severity level"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 20, max: 100)"),
    },
    async ({ scanId, brandId, severity, page, pageSize }) => {
      try {
        const client = clientFromEnv();
        const result = await client.listFindings({
          scanId,
          brandId,
          severity: severity as Severity | undefined,
          page,
          pageSize: Math.min(pageSize ?? 20, 100),
        });
        return { content: [{ type: "text", text: formatFindingList(result, scanId) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    }
  );

  // ── scan_and_report ─────────────────────────────────────────────────────────

  server.tool(
    "scan_and_report",
    "Run a full GuardBee scan and immediately return all critical and high findings with remediation guidance. Best for quick security assessments.",
    {
      url: z.string().url().describe("Target URL to scan"),
      scenario: z
        .enum(["quick", "kvkkFocus", "gdprFocus", "ccpaFocus"])
        .optional()
        .describe("Scan scenario (default: quick)"),
    },
    async ({ url, scenario }) => {
      try {
        const client = clientFromEnv();

        // Start scan
        const scan = await client.createScan({ url, scenario: scenario as ScanScenario | undefined ?? "quick" });
        const scanId = scan.id;

        // Wait for completion (up to 10 min)
        const completed = await client.waitForScan(scanId, { maxWaitMs: 600_000 });

        if (completed.status !== "COMPLETED") {
          return {
            content: [{
              type: "text",
              text: `Scan ${scanId} ended with status ${completed.status}. Check dashboard for details.`,
            }],
          };
        }

        const lines: string[] = [];

        if (completed.summary) {
          lines.push(formatSummary(completed.summary, url, scanId));
          lines.push("");
        }

        // Fetch critical + high findings
        const [critResult, highResult] = await Promise.all([
          client.listFindings({ scanId, severity: "CRITICAL", pageSize: 50 }),
          client.listFindings({ scanId, severity: "HIGH", pageSize: 50 }),
        ]);

        const urgentFindings = [...critResult.data, ...highResult.data];

        if (urgentFindings.length > 0) {
          lines.push(`Critical & High Findings (${urgentFindings.length}):`);
          lines.push("─".repeat(60));
          urgentFindings.forEach((f, i) => {
            lines.push(formatFindingList({ data: [f], pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 } }));
          });
        } else {
          lines.push("✅ No critical or high severity findings.");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
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
    ].join("\n");
  }
  if (err instanceof GuardBeeApiError) {
    return `❌ GuardBee API error (${err.status}): ${err.message}${err.code ? ` [${err.code}]` : ""}`;
  }
  return `❌ Error: ${err instanceof Error ? err.message : String(err)}`;
}
