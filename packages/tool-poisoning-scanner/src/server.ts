import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { DESCRIPTION_INJECTION_PATTERNS, MISMATCH_SINK_RULES } from "./patterns.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No tool-poisoning or confused-deputy findings. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
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
    name: "guardbee-tool-poisoning-scanner",
    version: "0.1.0",
  });
  instrumentServer(server, "tool-poisoning-scanner");

  server.tool(
    "scan_text",
    "Scan MCP server source for tool poisoning (hidden instructions embedded in a tool's `description` string, read by the calling LLM as trusted context) and confused-deputy tools (a name/description promising read-only behavior while the handler has a shell/eval/file-write/env-dump sink).",
    {
      content: z.string().describe("The source code to scan"),
      label: z.string().optional().describe("Optional label shown in findings (e.g. filename)"),
    },
    async ({ content, label }) => {
      const findings = scanText(content, label);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan a single file for tool-poisoning and confused-deputy patterns in MCP tool registrations",
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
    "Recursively scan a directory of MCP server source for tool-poisoning and confused-deputy patterns",
    {
      path: z.string().describe("Absolute or relative path to the directory to scan"),
      maxFiles: z.number().optional().describe("Maximum number of files to scan (default: 5000)"),
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
    "List every description-injection phrase and confused-deputy sink rule this scanner detects",
    {},
    async () => {
      const lines = ["[description-injection]"];
      for (const p of DESCRIPTION_INJECTION_PATTERNS) lines.push(`  • ${p.name} (${p.id}, ${p.severity})`);
      lines.push("", "[confused-deputy]", "  A tool whose name/description implies read-only/informational behavior, but whose handler contains:");
      for (const r of MISMATCH_SINK_RULES) lines.push(`  • ${r.category} (${r.id}, ${r.severity})`);
      lines.push("", "Scope: the MCP TypeScript SDK's `server.tool(name, description, schema, handler)` convenience form. Raw setRequestHandler()-style tool lists and non-JS/TS servers are not covered — see README.");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
