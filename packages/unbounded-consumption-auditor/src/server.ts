import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { UNBOUNDED_CONSUMPTION_PATTERNS } from "./patterns.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No unbounded-consumption issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
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
    name: "guardbee-unbounded-consumption-auditor",
    version: "0.1.0",
  });
  instrumentServer(server, "unbounded-consumption-auditor");

  server.tool(
    "scan_text",
    "Scan LLM/agent application code for Unbounded Consumption (\"denial of wallet\") anti-patterns from OWASP LLM Top 10 2026's #6 category: LLM calls with no output token limit, hand-rolled HTTP calls to an LLM endpoint with no timeout, agent tool-calling or retry loops with no iteration cap, framework safety limits (LangChain max_iterations, openai-agents max_turns) explicitly disabled, and MCP tool handlers that make billable calls with no visible rate limiting.",
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
    "Scan a single file for Unbounded Consumption / denial-of-wallet anti-patterns",
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
    "Recursively scan a directory of LLM/agent application source for Unbounded Consumption / denial-of-wallet anti-patterns",
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
    "List every Unbounded Consumption / denial-of-wallet pattern this auditor detects, grouped by category",
    {},
    async () => {
      const lines = ["Supported Unbounded Consumption (OWASP LLM Top 10 2026 #6) patterns:\n"];
      const byCategory = new Map<string, typeof UNBOUNDED_CONSUMPTION_PATTERNS>();
      for (const p of UNBOUNDED_CONSUMPTION_PATTERNS) {
        const list = byCategory.get(p.category) ?? [];
        list.push(p);
        byCategory.set(p.category, list);
      }
      for (const [category, patterns] of byCategory) {
        lines.push(`[${category}]`);
        for (const p of patterns) lines.push(`  • ${p.name} (${p.id}, ${p.severity})`);
        lines.push("");
      }
      lines.push("[missing-token-limit] (checked separately — flags an *absence* within the call span)");
      lines.push("  • OpenAI chat completion call missing max_tokens/max_completion_tokens (openai_chat_completion_missing_max_tokens, medium)");
      lines.push("");
      lines.push("[missing-timeout] (checked separately — scoped to hand-rolled calls to a known LLM endpoint)");
      lines.push("  • Raw requests/axios/fetch call to an LLM endpoint with no timeout/signal (raw_http_call_to_llm_endpoint_missing_timeout, medium)");
      lines.push("");
      lines.push("[unbounded-loop] (checked separately — bounded-window loop-body heuristics)");
      lines.push("  • Hand-rolled while(true)/while True: agent loop dispatching tool_calls with no iteration cap (unbounded_tool_calling_loop, medium)");
      lines.push("  • Retry loop that catches an exception and continues with no attempt counter (unbounded_retry_loop, medium)");
      lines.push("");
      lines.push("[missing-rate-limit] (checked separately — heuristic, scoped to MCP tool handler definitions)");
      lines.push("  • MCP tool handler makes a billable LLM call with nothing suggesting per-caller rate limiting (mcp_tool_billable_call_no_rate_limit, medium)");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
