import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { A2A_AUDIT_PATTERNS } from "./patterns.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No A2A (Agent2Agent) issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
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
    name: "guardbee-a2a-auditor",
    version: "0.1.0",
  });
  instrumentServer(server, "a2a-auditor");

  server.tool(
    "scan_text",
    "Scan Agent2Agent (A2A) protocol implementation code for anti-patterns found in the reference SDKs and sample agents: an Agent Card fetching a client-supplied push-notification webhook URL with no host allowlist (SSRF), a request handler wired up with no authentication at all, and a literal credential embedded directly in Agent Card metadata (which is served publicly).",
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
    "Scan a single file for A2A (Agent2Agent) protocol anti-patterns",
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
    "Recursively scan a directory of A2A agent source for protocol anti-patterns",
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
    "List every A2A (Agent2Agent) protocol pattern this auditor detects, grouped by category",
    {},
    async () => {
      const lines = ["Supported A2A (Agent2Agent) protocol patterns:\n"];
      const byCategory = new Map<string, typeof A2A_AUDIT_PATTERNS>();
      for (const p of A2A_AUDIT_PATTERNS) {
        const list = byCategory.get(p.category) ?? [];
        list.push(p);
        byCategory.set(p.category, list);
      }
      for (const [category, patterns] of byCategory) {
        lines.push(`[${category}]`);
        for (const p of patterns) lines.push(`  • ${p.name} (${p.id}, ${p.severity})`);
        lines.push("");
      }
      lines.push("[webhook-ssrf] (checked separately — indirected via a local variable)");
      lines.push("  • Push-notification webhook URL fetched via a variable assigned from *Config.url (webhook_url_indirect_fetch_no_allowlist, critical)");
      lines.push("");
      lines.push("[missing-authentication] (checked separately — flags an *absence*, not a fixed pattern)");
      lines.push("  • Agent Card with empty securitySchemes and securityRequirements (empty_agent_card_security, high)");
      lines.push("  • Python AgentCard(...) missing both security_schemes and security_requirements (python_agent_card_no_auth, high)");
      lines.push("");
      lines.push("[credential-exposure] (checked separately — scoped to Agent Card object literals)");
      lines.push("  • Literal apiKey/token/secret inside an Agent Card object (agent_card_credential_in_metadata, high)");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
