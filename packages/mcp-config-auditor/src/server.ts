import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanConfigFile, scanConfigText, scanDirectory, scanInventory } from "./scanner.js";
import type { ConfigFinding, InventoryServer } from "./types.js";

function formatFindings(findings: ConfigFinding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No MCP config issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
  }
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) bySeverity[finding.severity]++;
  const lines = [
    `⚠️  Found ${findings.length} MCP config issue(s) in ${scannedFiles} file(s) (${durationMs}ms)`,
    `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}  Low: ${bySeverity.low}`,
    "",
  ];
  for (const finding of findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.patternName} (${finding.owasp})`);
    if (finding.server) lines.push(`  Server         : ${finding.server}`);
    if (finding.file) lines.push(`  Location       : ${finding.file}:${finding.line}:${finding.column}`);
    lines.push(`  Match          : ${finding.match}`);
    lines.push(`  Recommendation : ${finding.recommendation}`);
    lines.push("");
  }
  return lines.join("\n");
}

const inventoryShape = z.object({
  servers: z.array(
    z.object({
      name: z.string(),
      tools: z.array(z.object({ name: z.string(), description: z.string().optional() })),
    })
  ),
});

export async function startServer() {
  const server = new McpServer({ name: "guardbee-mcp-config-auditor", version: "0.1.0" });
  instrumentServer(server, "mcp-config-auditor");

  server.tool(
    "scan_config_text",
    "Scan an MCP client config JSON string (Cursor mcp.json, Claude Desktop, Windsurf, or VS Code) for unpinned packages, secrets, wildcard auto-approve, unauthenticated remote endpoints, and typosquats.",
    {
      content: z.string().describe("Raw JSON config"),
      label: z.string().optional().describe("Optional filename shown in findings"),
    },
    async ({ content, label }) => {
      const findings = scanConfigText(content, label);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan one MCP client config file.",
    { path: z.string().describe("Path to the config file") },
    async ({ path: filePath }) => {
      const { findings, skipped } = scanConfigFile(filePath);
      if (skipped) return { content: [{ type: "text", text: `⏭️  File skipped (missing or too large): ${filePath}` }] };
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Find mcp.json, mcp_config.json, and claude_desktop_config.json under a directory and audit each one. Does not start any MCP server.",
    {
      path: z.string().describe("Directory to search"),
      maxFiles: z.number().int().positive().optional().describe("Maximum files to consider (default: 5000)"),
      exclude: z.array(z.string()).optional().describe("Skip paths containing one of these strings"),
    },
    async ({ path: dirPath, maxFiles, exclude }) => {
      const result = scanDirectory(dirPath, { maxFiles, exclude });
      return { content: [{ type: "text", text: formatFindings(result.findings, result.scannedFiles, result.durationMs) }] };
    }
  );

  server.tool(
    "scan_inventory",
    "Detect cross-server tool shadowing from an inventory of tool catalogs. Pass the tool names and descriptions already collected from each installed server. This tool does not connect to those servers.",
    {
      inventory: z.string().describe('JSON: {"servers":[{"name":"github","tools":[{"name":"create_issue","description":"..."}]}]}'),
    },
    async ({ inventory }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(inventory);
      } catch (err) {
        return { content: [{ type: "text", text: `Inventory JSON could not be parsed: ${err instanceof Error ? err.message : String(err)}` }] };
      }
      const check = inventoryShape.safeParse(parsed);
      if (!check.success) {
        return { content: [{ type: "text", text: "Inventory must be { servers: [{ name, tools: [{ name, description? }] }] }" }] };
      }
      const findings = scanInventory(check.data.servers as InventoryServer[]);
      return { content: [{ type: "text", text: formatFindings(findings, check.data.servers.length, 0) }] };
    }
  );

  server.tool(
    "list_patterns",
    "List the MCP config and cross-server shadowing checks, with their OWASP MCP Top 10 tags.",
    {},
    async () => {
      const lines = [
        "Config checks:",
        "  • unpinned_package (MCP04:2025, high)",
        "  • typosquat_package (MCP04:2025, critical)",
        "  • secret_in_env (MCP01:2025, critical)",
        "  • secret_in_args (MCP01:2025, critical)",
        "  • auto_approve_wildcard (MCP02:2025, critical)",
        "  • cleartext_remote (MCP07:2025, high)",
        "  • unauthenticated_remote (MCP07:2025, high/medium)",
        "",
        "Inventory checks:",
        "  • cross_server_tool_shadow (MCP03:2025, high)",
        "  • confusable_tool_name (MCP03:2025, critical)",
        "  • cross_server_tool_redirect (MCP03:2025, high)",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
