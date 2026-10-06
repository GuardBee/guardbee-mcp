import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import {
  defaultHostConfigPaths,
  discoverHostMcp,
  parseAllowlist,
  scanConfigFile,
  scanConfigText,
  scanDirectory,
  scanInventory,
  scanSkillText,
} from "./scanner.js";
import type { ConfigFinding, InventoryServer } from "./types.js";

function formatFindings(findings: ConfigFinding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No MCP config issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
  }
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) bySeverity[finding.severity]++;
  const lines = [
    `⚠️  Found ${findings.length} issue(s) in ${scannedFiles} file(s) (${durationMs}ms)`,
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
    "Scan one MCP client config file, or a SKILL.md agent skill when the file has that name.",
    { path: z.string().describe("Path to the config file") },
    async ({ path: filePath }) => {
      const { findings, skipped } = scanConfigFile(filePath);
      if (skipped) return { content: [{ type: "text", text: `⏭️  File skipped (missing or too large): ${filePath}` }] };
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_skill_text",
    "Scan one agent SKILL.md (YAML frontmatter plus body) for unrestricted allowed-tools, instruction override, credential file reads, and literal secrets. Name collisions across skills require a directory scan.",
    {
      content: z.string().describe("Raw SKILL.md text"),
      label: z.string().optional().describe("Optional filename shown in findings"),
    },
    async ({ content, label }) => {
      const findings = scanSkillText(content, label);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Find mcp.json, mcp_config.json, claude_desktop_config.json, and SKILL.md under a directory and audit each one. A directory scan also compares skill names. Does not start any MCP server.",
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
    "discover_shadow_mcp",
    "OWASP MCP09:2025 — discover MCP client configs in well-known host paths (Cursor, Claude Desktop, Windsurf, VS Code, Claude Code) and flag servers that are not on an organization allowlist (Shadow MCP). Does not start any MCP server.",
    {
      allowlist: z
        .string()
        .optional()
        .describe(
          'JSON allowlist: {"names":["filesystem"],"packages":["@modelcontextprotocol/server-filesystem"],"hosts":["mcp.example.com"]} or line form name:/package:/host:'
        ),
      home: z.string().optional().describe("Override home directory used to resolve well-known config paths"),
      includeContentAudit: z
        .boolean()
        .optional()
        .describe("Also run the normal config content checks on each discovered file (default false)"),
    },
    async ({ allowlist: allowlistText, home, includeContentAudit }) => {
      let allowlist = null;
      if (allowlistText?.trim()) {
        try {
          allowlist = parseAllowlist(allowlistText);
        } catch (err) {
          return {
            content: [{ type: "text", text: `Allowlist error: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
      const result = discoverHostMcp({ home, allowlist, includeContentAudit });
      const header = `Discovered ${result.scannedFiles} config(s); ${result.missingPaths} well-known path(s) absent.\n\n`;
      return {
        content: [{ type: "text", text: header + formatFindings(result.findings, result.scannedFiles, result.durationMs) }],
      };
    }
  );

  server.tool(
    "list_host_config_paths",
    "List the well-known MCP client config paths this auditor checks during shadow (MCP09) discovery on the current OS.",
    {
      home: z.string().optional().describe("Override home directory"),
    },
    async ({ home }) => {
      const paths = defaultHostConfigPaths(home);
      const lines = ["Well-known MCP client config paths:\n", ...paths.map((p) => `  • ${p.client}: ${p.path}`)];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "list_patterns",
    "List the MCP config, agent skill, shadow-MCP discovery, and cross-server shadowing checks, with their OWASP MCP Top 10 tags.",
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
        "Shadow MCP discovery (MCP09:2025):",
        "  • shadow_mcp_server (high) — server not on allowlist",
        "  • allowlist_not_configured (medium)",
        "  • unreviewed_mcp_server (low) — discovered without allowlist",
        "  • shadow_config_unreadable (medium)",
        "  • mcp_server_drift_across_clients (medium)",
        "",
        "Agent skill checks (SKILL.md):",
        "  • skill_unrestricted_shell (MCP02:2025, critical)",
        "  • skill_unrestricted_write (MCP02:2025, high)",
        "  • skill_instruction_override (MCP06:2025, critical)",
        "  • skill_covert_instruction (MCP06:2025, critical)",
        "  • skill_secret_file_read (MCP01:2025, critical)",
        "  • skill_at_secret_ref (MCP01:2025, critical)",
        "  • secret_in_skill (MCP01:2025, critical)",
        "  • skill_name_shadow (MCP03:2025, high) — directory scan",
        "  • skill_confusable_name (MCP03:2025, critical) — directory scan",
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
