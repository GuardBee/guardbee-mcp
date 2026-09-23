import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanBody, scanFile, scanDirectory } from "./scanner.js";
import { LEAK_PATTERNS } from "./patterns.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No leaked credentials or PII found. Scanned ${scannedFiles} item(s) in ${durationMs}ms.`;
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const lines: string[] = [
    `⚠️  Found ${findings.length} finding(s) in ${scannedFiles} item(s) (${durationMs}ms)`,
    `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}  Low: ${bySeverity.low}`,
    "",
  ];

  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.category})`);
    lines.push(`  Location       : ${f.location}:${f.line}:${f.column}`);
    lines.push(`  Value          : ${f.maskedMatch} (masked)`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-prompt-leak-scanner",
    version: "0.1.0",
  });
  instrumentServer(server, "prompt-leak-scanner");

  server.tool(
    "scan_text",
    "Scan a raw text string (e.g. a prompt you're about to send to an LLM) for leaked credentials (API keys, private keys, JWTs) and PII (TC Kimlik No, credit card, IBAN, email, phone) — checksum-validated where applicable to keep false positives low.",
    {
      content: z.string().describe("The text to scan"),
      label: z.string().optional().describe("Optional label shown in findings"),
    },
    async ({ content, label }) => {
      const findings = scanText(content, label);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_messages",
    "Scan an OpenAI/Anthropic-style chat request body (a JSON object with a `messages` array and/or a `system` field) for leaked credentials and PII in every message's text content, before it would be sent to the model.",
    {
      body: z.record(z.string(), z.unknown()).describe("The chat request body object, e.g. { model, system, messages: [{ role, content }] }"),
    },
    async ({ body }) => {
      const { findings } = scanBody(body);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan a single file — plain text, or a JSON chat-request-body fixture (auto-detected) — for leaked credentials and PII",
    {
      path: z.string().describe("Absolute or relative path to the file to scan"),
    },
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
    "Recursively scan a directory of prompt logs or request-body fixtures for leaked credentials and PII",
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
    "List every credential/PII pattern this scanner detects, grouped by category",
    {},
    async () => {
      const lines = ["Detected patterns:\n"];
      const byCategory = new Map<string, typeof LEAK_PATTERNS>();
      for (const p of LEAK_PATTERNS) {
        const list = byCategory.get(p.category) ?? [];
        list.push(p);
        byCategory.set(p.category, list);
      }
      for (const [category, patterns] of byCategory) {
        lines.push(`[${category}]`);
        for (const p of patterns) lines.push(`  • ${p.name} (${p.id}, ${p.severity})${p.validate ? " — checksum-validated" : ""}`);
        lines.push("");
      }
      lines.push("Use the `proxy` CLI command to run this as a live reverse proxy in front of a real LLM API (monitor/redact/block modes).");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
