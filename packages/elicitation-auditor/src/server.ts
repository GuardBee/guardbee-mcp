import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { ELICITATION_CHECKS } from "./patterns.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No elicitation issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
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
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.category})`);
    lines.push(`  Location       : ${loc}`);
    lines.push(`  Match          : ${f.match}`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-elicitation-auditor",
    version: "0.1.1",
  });
  instrumentServer(server, "elicitation-auditor");

  server.tool(
    "scan_text",
    "Scan MCP server source for elicitation anti-patterns from the 2026-07-28 spec: form mode requesting secrets or embedding a link, URL mode opened directly on a third-party authorize endpoint, credentials in the elicitation URL, a form answer used as the user's identity, and a result used without checking decline or cancel.",
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
    "Scan a single file for elicitation anti-patterns",
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
    "Recursively scan a directory of MCP server source for elicitation anti-patterns",
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
    "List every elicitation check this auditor runs",
    {},
    async () => {
      const lines = ["Supported elicitation checks:\n"];
      const byCategory = new Map<string, typeof ELICITATION_CHECKS>();
      for (const check of ELICITATION_CHECKS) {
        const list = byCategory.get(check.category) ?? [];
        list.push(check);
        byCategory.set(check.category, list);
      }
      for (const [category, checks] of byCategory) {
        lines.push(`[${category}]`);
        for (const check of checks) lines.push(`  • ${check.name} (${check.id}, ${check.severity})`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
