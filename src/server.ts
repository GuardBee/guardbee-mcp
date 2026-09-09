import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { SECRET_PATTERNS } from "./patterns.js";

function formatFindings(result: ReturnType<typeof scanDirectory>) {
  if (result.totalFindings === 0) {
    return `✅ No secrets found. Scanned ${result.scannedFiles} files in ${result.durationMs}ms.`;
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of result.findings) bySeverity[f.severity]++;

  const lines: string[] = [
    `⚠️  Found ${result.totalFindings} potential secret(s) in ${result.scannedFiles} files (${result.durationMs}ms)`,
    `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}  Low: ${bySeverity.low}`,
    "",
  ];

  for (const f of result.findings) {
    const loc = f.file ? `${f.file}:${f.line}:${f.column}` : `line ${f.line}:${f.column}`;
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName}`);
    lines.push(`  Location : ${loc}`);
    lines.push(`  Match    : ${f.match}`);
    lines.push(`  Context  : ${f.context}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-secret-scanner",
    version: "0.1.0",
  });

  server.tool(
    "scan_text",
    "Scan a text string or code snippet for exposed secrets and API keys",
    {
      content: z.string().describe("The text content to scan"),
      label: z.string().optional().describe("Optional label shown in findings (e.g. filename)"),
    },
    async ({ content, label }) => {
      const findings = scanText(content, label);

      if (findings.length === 0) {
        return {
          content: [{ type: "text", text: "✅ No secrets found in the provided text." }],
        };
      }

      const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const f of findings) bySeverity[f.severity]++;

      const lines = [
        `⚠️  Found ${findings.length} potential secret(s)`,
        `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}  Low: ${bySeverity.low}`,
        "",
      ];
      for (const f of findings) {
        const loc = label ? `${label}:${f.line}:${f.column}` : `line ${f.line}:${f.column}`;
        lines.push(`[${f.severity.toUpperCase()}] ${f.patternName}`);
        lines.push(`  Location : ${loc}`);
        lines.push(`  Match    : ${f.match}`);
        lines.push(`  Context  : ${f.context}`);
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan a single file for exposed secrets and API keys",
    {
      path: z.string().describe("Absolute or relative path to the file to scan"),
    },
    async ({ path: filePath }) => {
      const { findings, skipped } = scanFile(filePath);

      if (skipped) {
        return {
          content: [{ type: "text", text: `⏭️  File skipped (binary, too large, or unreadable): ${filePath}` }],
        };
      }

      if (findings.length === 0) {
        return {
          content: [{ type: "text", text: `✅ No secrets found in ${filePath}` }],
        };
      }

      const result = {
        scannedFiles: 1,
        skippedFiles: 0,
        totalFindings: findings.length,
        findings,
        durationMs: 0,
      };

      return { content: [{ type: "text", text: formatFindings(result) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Recursively scan a directory for exposed secrets and API keys. Automatically skips node_modules, .git, dist, and binary files.",
    {
      path: z.string().describe("Absolute or relative path to the directory to scan"),
      maxFiles: z.number().optional().describe("Maximum number of files to scan (default: 5000)"),
      include: z
        .array(z.string())
        .optional()
        .describe("Only scan files whose path contains one of these strings (e.g. [\".env\", \".ts\"])"),
      exclude: z
        .array(z.string())
        .optional()
        .describe("Skip files/dirs whose path contains one of these strings"),
    },
    async ({ path: dirPath, maxFiles, include, exclude }) => {
      const result = scanDirectory(dirPath, { maxFiles, include, exclude });
      return { content: [{ type: "text", text: formatFindings(result) }] };
    }
  );

  server.tool(
    "list_patterns",
    "List all secret patterns that the scanner can detect",
    {},
    async () => {
      const lines = ["Supported secret patterns:\n"];
      const bySeverity = new Map<string, typeof SECRET_PATTERNS>();
      for (const p of SECRET_PATTERNS) {
        const list = bySeverity.get(p.severity) ?? [];
        list.push(p);
        bySeverity.set(p.severity, list);
      }
      for (const sev of ["critical", "high", "medium", "low"]) {
        const patterns = bySeverity.get(sev) ?? [];
        if (patterns.length === 0) continue;
        lines.push(`[${sev.toUpperCase()}]`);
        for (const p of patterns) lines.push(`  • ${p.name} (${p.id})`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
