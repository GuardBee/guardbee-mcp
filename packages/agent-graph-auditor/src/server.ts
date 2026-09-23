import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { CAPABILITY_RULES } from "./capabilities.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No excessive-agency paths found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
  }

  const bySeverity = { critical: 0, high: 0, medium: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const lines: string[] = [
    `⚠️  Found ${findings.length} excessive-agency finding(s) in ${scannedFiles} file(s) (${durationMs}ms)`,
    `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}`,
    "",
  ];

  for (const f of findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.category})`);
    if (f.file) lines.push(`  File           : ${f.file}`);
    lines.push(`  Path           : ${f.match}`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-agent-graph-auditor",
    version: "0.1.0",
  });
  instrumentServer(server, "agent-graph-auditor");

  server.tool(
    "scan_text",
    "Scan a Python snippet defining a multi-agent orchestration (LangGraph, CrewAI, or AutoGen/ag2) for excessive agency reachable through delegation or group membership — an agent with no dangerous tool of its own that can still reach one (shell/code-exec/file-write/network/credentials) through another agent it can hand off to.",
    {
      content: z.string().describe("The Python source to scan"),
      label: z.string().optional().describe("Optional label shown in findings (e.g. filename)"),
    },
    async ({ content, label }) => {
      const findings = scanText(content, label);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan a single Python file for excessive-agency paths across LangGraph/CrewAI/AutoGen orchestration constructs",
    { path: z.string().describe("Absolute or relative path to the .py file to scan") },
    async ({ path: filePath }) => {
      const { findings, skipped } = scanFile(filePath);
      if (skipped) {
        return { content: [{ type: "text", text: `⏭️  File skipped (not .py, too large, or unreadable): ${filePath}` }] };
      }
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Recursively scan a directory of Python files and report excessive-agency paths found in each. Each file's agent/tool graph is analyzed independently — variable references don't resolve across files, so a Crew/GroupChat whose members are defined in a different file than the assembling call won't be connected.",
    {
      path: z.string().describe("Absolute or relative path to the directory to scan"),
      maxFiles: z.number().optional().describe("Maximum number of files to scan (default: 2000)"),
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
    "List every dangerous-capability rule this auditor looks for at the end of a delegation path, grouped by category",
    {},
    async () => {
      const lines = ["Dangerous capability catalog (what a tool at the end of a delegation path grants):\n"];
      const byCategory = new Map<string, typeof CAPABILITY_RULES>();
      for (const r of CAPABILITY_RULES) {
        const list = byCategory.get(r.category) ?? [];
        list.push(r);
        byCategory.set(r.category, list);
      }
      for (const [category, rules] of byCategory) {
        lines.push(`[${category}]`);
        for (const r of rules) lines.push(`  • ${r.id} (${r.severity})`);
        lines.push("");
      }
      lines.push("Supported frameworks: LangGraph (structural — add_node/add_edge is read directly), CrewAI (heuristic — Crew membership + allow_delegation), AutoGen/ag2 (heuristic — GroupChat membership, code_execution_config, register_function).");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
