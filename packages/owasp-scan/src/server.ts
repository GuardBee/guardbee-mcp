import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanPath, scanLive, scanCatalogJson } from "./orchestrator.js";
import { OWASP_TITLES } from "./owaspMap.js";
import type { OwaspReport } from "./types.js";

function formatReport(report: OwaspReport): string {
  const lines: string[] = [
    `Grade ${report.grade} (${report.score}/100) — ${report.totalFindings} finding(s), ${report.durationMs}ms`,
    `mode=${report.mode} label=${report.label}`,
    "",
  ];
  for (const bucket of report.byOwasp) {
    lines.push(`${bucket.id} ${bucket.title}: ${bucket.findingCount}`);
  }
  lines.push("");
  for (const f of report.findings.slice(0, 40)) {
    const loc = f.file ? `${f.file}:${f.line ?? 0}` : f.tools?.join(", ") ?? f.source;
    lines.push(`[${f.severity}] ${f.owasp} ${f.patternName} (${loc})`);
    lines.push(`  ${f.recommendation}`);
  }
  if (report.findings.length > 40) lines.push(`… +${report.findings.length - 40} more`);
  if (report.totalFindings === 0) lines.push("✅ No OWASP MCP Top 10 findings.");
  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-owasp-scan",
    version: "0.1.0",
  });
  instrumentServer(server, "owasp-scan");

  server.tool(
    "owasp_scan_path",
    "Run a unified OWASP MCP Top 10 scan over a filesystem path — orchestrates secret, server, oauth, audit-gap, context-oversharing, toxic-flow, and tool-poisoning auditors; returns A–F grade.",
    {
      path: z.string().describe("File or directory to scan"),
      maxFiles: z.number().int().positive().optional(),
      discoverShadow: z.boolean().optional().describe("Also discover Shadow MCP on this host (MCP09)"),
      allowlistPath: z.string().optional().describe("Allowlist file for Shadow MCP discover"),
    },
    async ({ path, maxFiles, discoverShadow, allowlistPath }) => {
      const report = scanPath(path, { maxFiles, discoverShadow, allowlistPath });
      return { content: [{ type: "text", text: formatReport(report) }] };
    }
  );

  server.tool(
    "owasp_scan_live",
    "Connect to a live MCP server (stdio or HTTP), call tools/list, then grade toxic-flow + tool-poisoning (MCP03/MCP10).",
    {
      url: z.string().url().optional().describe("Streamable HTTP MCP URL"),
      command: z.string().optional().describe("stdio command to spawn"),
      args: z.array(z.string()).optional(),
    },
    async ({ url, command, args }) => {
      if (url) {
        const report = await scanLive({ type: "http", url });
        return { content: [{ type: "text", text: formatReport(report) }] };
      }
      if (command) {
        const report = await scanLive({ type: "stdio", command, args });
        return { content: [{ type: "text", text: formatReport(report) }] };
      }
      return { content: [{ type: "text", text: "Provide either url or command." }], isError: true };
    }
  );

  server.tool(
    "owasp_scan_catalog",
    "Audit a tools/list JSON dump for toxic flows and tool-description poisoning (MCP03/MCP10).",
    {
      catalog: z.string().describe("JSON string: { tools: [...] } or a bare tools array"),
      label: z.string().optional(),
    },
    async ({ catalog, label }) => {
      const report = scanCatalogJson(catalog, label);
      return { content: [{ type: "text", text: formatReport(report) }] };
    }
  );

  server.tool(
    "list_owasp_coverage",
    "List OWASP MCP Top 10 categories and which GuardBee scanners cover them in this meta-scan",
    {},
    async () => {
      const lines = ["OWASP MCP Top 10 coverage in @guardbee/mcp-owasp-scan:\n"];
      for (const [id, title] of Object.entries(OWASP_TITLES)) {
        lines.push(`${id} — ${title}`);
      }
      lines.push("");
      lines.push("Path scan: MCP01 secrets, MCP02/05 server-auditor, MCP03 poisoning, MCP07 oauth, MCP08 audit-gap, MCP09 discover (opt), MCP10 toxic-flow + context-oversharing.");
      lines.push("Live/catalog: MCP03 poisoning + MCP10 toxic-flow (and related pairs).");
      lines.push("MCP04 supply-chain: use @guardbee/mcp-dependency-auditor / slopsquat-scanner separately (network).");
      lines.push("MCP06 prompt injection in RAG content: use @guardbee/mcp-prompt-injection-scanner separately.");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
