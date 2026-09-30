import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { auditCatalog, parseToolsJson, type AuditResult, type Finding } from "./analyzer.js";
import { scanDirectory, scanSourceFile, scanSourceText } from "./scanner.js";

function formatAudit(result: AuditResult, extra = ""): string {
  const lines: string[] = [
    `Grade ${result.grade} (score ${result.score}/100) — ${result.toolCount} tool(s) in ${result.durationMs}ms`,
    `  untrusted-content : ${result.byCapability["untrusted-content"].join(", ") || "—"}`,
    `  sensitive-data    : ${result.byCapability["sensitive-data"].join(", ") || "—"}`,
    `  exfiltration      : ${result.byCapability.exfiltration.join(", ") || "—"}`,
    `  destructive       : ${result.byCapability.destructive.join(", ") || "—"}`,
    "",
  ];
  if (extra) lines.unshift(extra);

  if (result.findings.length === 0) {
    lines.push("✅ No toxic-flow or dangerous capability pairs found.");
    return lines.join("\n");
  }

  lines.push(`⚠️  ${result.findings.length} finding(s):`);
  lines.push("");
  for (const f of result.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.owasp})`);
    lines.push(`  Tools          : ${f.tools.join(", ")}`);
    lines.push(`  Capabilities   : ${f.capabilities.join(", ")}`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-toxic-flow-auditor",
    version: "0.1.0",
  });
  instrumentServer(server, "toxic-flow-auditor");

  server.tool(
    "audit_catalog",
    "Audit a tools/list-shaped JSON catalog for the lethal trifecta (toxic flow): untrusted content + sensitive/private data + exfiltration or destruction on the same MCP server. Returns an A–F grade.",
    {
      catalog: z.string().describe("JSON array of tools, or { tools: [...] } from tools/list"),
      label: z.string().optional().describe("Optional label for the server/catalog"),
    },
    async ({ catalog, label }) => {
      const tools = parseToolsJson(catalog);
      const result = auditCatalog(tools, label ?? "catalog");
      return { content: [{ type: "text", text: formatAudit(result) }] };
    }
  );

  server.tool(
    "scan_source",
    "Scan TypeScript/JavaScript MCP server source for .tool(...) registrations and audit them for toxic flows",
    {
      content: z.string().describe("Source code to scan"),
      label: z.string().optional(),
    },
    async ({ content, label }) => {
      const result = scanSourceText(content, label);
      return { content: [{ type: "text", text: formatAudit(result) }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan a single source file for toxic flows",
    { path: z.string() },
    async ({ path: filePath }) => {
      const { result, skipped } = scanSourceFile(filePath);
      if (skipped) {
        return { content: [{ type: "text", text: `⏭️  File skipped: ${filePath}` }] };
      }
      return { content: [{ type: "text", text: formatAudit(result) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Recursively scan a directory of MCP server source for toxic flows across all registered tools",
    {
      path: z.string(),
      maxFiles: z.number().int().positive().optional(),
      exclude: z.array(z.string()).optional(),
    },
    async ({ path: dirPath, maxFiles, exclude }) => {
      const result = scanDirectory(dirPath, { maxFiles, exclude });
      return {
        content: [
          {
            type: "text",
            text: formatAudit(result, `Scanned ${result.scannedFiles} file(s), skipped ${result.skippedFiles}.`),
          },
        ],
      };
    }
  );

  server.tool(
    "explain_trifecta",
    "Explain the lethal trifecta / toxic-flow model this auditor uses",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: [
            "Lethal trifecta (Simon Willison) / toxic flow:",
            "1. Untrusted content — fetch, scrape, browse, issues, feeds the model will read",
            "2. Sensitive data — secrets, DB, vault, mailboxes, KVKK-regulated PII",
            "3. Exfiltration or destruction — send, webhook, export, delete, drop",
            "",
            "When one MCP server exposes all three, a prompt injection can chain them.",
            "Mapped primarily to OWASP MCP10:2025 (context over-sharing / toxic combination).",
            "Also reports dangerous pairs (sensitive+exfil, untrusted+exfil, sensitive+destruct).",
          ].join("\n"),
        },
      ],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export type { Finding };
