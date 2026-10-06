import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { CONTEXT_OVERSHARE_CHECKS } from "./patterns.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No context-oversharing issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
  }

  const bySeverity = { critical: 0, high: 0, medium: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const lines: string[] = [
    `⚠️  Found ${findings.length} finding(s) in ${scannedFiles} file(s) (${durationMs}ms)`,
    `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}`,
    "",
  ];

  for (const f of findings) {
    const loc = f.file ? `${f.file}:${f.line}:${f.column}` : `line ${f.line}:${f.column}`;
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.category}, ${f.owasp})`);
    lines.push(`  Location       : ${loc}`);
    lines.push(`  Match          : ${f.match}`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-context-oversharing-auditor",
    version: "0.1.0",
  });
  instrumentServer(server, "context-oversharing-auditor");

  server.tool(
    "scan_text",
    "Scan agent/MCP source for OWASP MCP10:2025 context oversharing — full conversation dumps, unscoped memory tools, shared global session stores, system-prompt leaks via tools, cross-session tool-result bleed, and unfiltered vector queries.",
    {
      content: z.string().describe("The code content to scan"),
      label: z.string().optional().describe("Optional label shown in findings (e.g. filename)"),
    },
    async ({ content, label }) => {
      const findings = scanText(content, label);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan a single file for OWASP MCP10 context-oversharing issues",
    { path: z.string().describe("Absolute or relative path to the file to scan") },
    async ({ path: filePath }) => {
      const { findings, skipped } = scanFile(filePath);
      if (skipped) {
        return { content: [{ type: "text", text: `⏭️  File skipped (binary, too large, or unreadable): ${filePath}` }] };
      }
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Recursively scan a directory for OWASP MCP10 context-oversharing issues",
    {
      path: z.string().describe("Absolute or relative path to the directory to scan"),
      maxFiles: z.number().int().positive().optional().describe("Maximum number of files to scan (default: 5000)"),
      include: z.array(z.string()).optional().describe("Only scan files whose path contains one of these strings"),
      exclude: z.array(z.string()).optional().describe("Skip files/dirs whose path contains one of these strings"),
    },
    async ({ path: dirPath, maxFiles, include, exclude }) => {
      const result = scanDirectory(dirPath, { maxFiles, include, exclude });
      return { content: [{ type: "text", text: formatFindings(result.findings, result.scannedFiles, result.durationMs) }] };
    }
  );

  server.tool(
    "list_patterns",
    "List every OWASP MCP10 context-oversharing check this auditor runs",
    {},
    async () => {
      const lines = ["Supported MCP10 context-oversharing checks:\n"];
      const byCategory = new Map<string, typeof CONTEXT_OVERSHARE_CHECKS>();
      for (const check of CONTEXT_OVERSHARE_CHECKS) {
        const list = byCategory.get(check.category) ?? [];
        list.push(check);
        byCategory.set(check.category, list);
      }
      for (const [category, checks] of byCategory) {
        lines.push(`[${category}]`);
        for (const check of checks) {
          lines.push(`  • ${check.name} (${check.id}, ${check.severity}, ${check.owasp})`);
        }
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
