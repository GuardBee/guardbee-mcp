import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { MEMORY_POISONING_PATTERNS } from "./patterns.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No memory-poisoning patterns found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
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
    name: "guardbee-memory-poisoning-scanner",
    version: "0.1.0",
  });
  instrumentServer(server, "memory-poisoning-scanner");

  server.tool(
    "scan_text",
    "Scan agent code for memory-poisoning risks: untrusted input written into persistent, cross-session memory (MemGPT-style archival/core memory, or a vector store used as a long-term knowledge base) without visible sanitization, and memory retrievals fed into a system/assistant-role message or prompt template as trusted context.",
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
    "Scan a single file for memory-write and memory-readback poisoning patterns",
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
    "Recursively scan a directory of agent source code for memory-poisoning patterns",
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
    "List every memory-write and memory-readback pattern this scanner detects, grouped by category",
    {},
    async () => {
      const lines = ["Supported memory-poisoning patterns:\n"];
      const byCategory = new Map<string, typeof MEMORY_POISONING_PATTERNS>();
      for (const p of MEMORY_POISONING_PATTERNS) {
        const list = byCategory.get(p.category) ?? [];
        list.push(p);
        byCategory.set(p.category, list);
      }
      for (const [category, patterns] of byCategory) {
        lines.push(`[${category}]`);
        for (const p of patterns) lines.push(`  • ${p.name} (${p.id}, ${p.severity})`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
