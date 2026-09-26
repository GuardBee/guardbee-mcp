import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { resolve } from "path";
import { baselineServer, checkServer, listBaselines } from "./core.js";
import type { ConnectionTarget } from "./types.js";
import type { CheckResult } from "./core.js";

const DEFAULT_BASE_DIR = resolve(process.cwd(), ".guardbee/tool-baselines");

const targetShape = {
  command: z.string().optional().describe("Command to spawn for a stdio MCP server (e.g. \"npx\")"),
  args: z.array(z.string()).optional().describe("Arguments for the stdio command"),
  env: z.record(z.string(), z.string()).optional().describe("Extra environment variables for the spawned process"),
  cwd: z.string().optional().describe("Working directory for the spawned process"),
  url: z.string().optional().describe("URL of a Streamable HTTP MCP server (alternative to command/args)"),
  label: z.string().optional().describe("Stable identifier for this server, used to look up its baseline. Defaults to the command line or URL."),
};

function resolveTarget(args: { command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string; label?: string }): { target: ConnectionTarget; label: string } {
  if (args.url) {
    return { target: { type: "http", url: args.url }, label: args.label ?? args.url };
  }
  if (args.command) {
    const label = args.label ?? [args.command, ...(args.args ?? [])].join(" ");
    return { target: { type: "stdio", command: args.command, args: args.args, env: args.env, cwd: args.cwd }, label };
  }
  throw new Error("Provide either `command` (stdio) or `url` (Streamable HTTP)");
}

function formatCheckResult(result: CheckResult): string {
  if (result.isNewBaseline) {
    return `📌 No prior baseline for this server — captured one now (${result.toolCount} tool(s)). Run check_server again after this server's next release/update to detect drift.`;
  }
  if (result.findings.length === 0) {
    return `✅ No drift. ${result.toolCount} tool(s) match the stored baseline exactly.`;
  }

  const bySeverity = { critical: 0, medium: 0, low: 0 };
  for (const f of result.findings) bySeverity[f.severity]++;

  const lines = [
    `⚠️  ${result.findings.length} finding(s) — Critical: ${bySeverity.critical}  Medium: ${bySeverity.medium}  Low: ${bySeverity.low}`,
    "",
  ];
  for (const f of result.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName}`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push(`  Detail         :\n    ${f.detail.split("\n").join("\n    ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({ name: "guardbee-rug-pull-detector", version: "0.1.0" });
  instrumentServer(server, "rug-pull-detector");

  server.tool(
    "baseline_server",
    "Connect to an MCP server (stdio command or Streamable HTTP URL), read its current tools/list response, and store it as the trusted baseline for future drift checks. Call this once, right after you've reviewed and approved a server's tools.",
    targetShape,
    async (args) => {
      const { target, label } = resolveTarget(args);
      const result = await baselineServer(target, label, DEFAULT_BASE_DIR);
      return { content: [{ type: "text", text: `📌 Baseline captured for "${label}" — ${result.toolCount} tool(s) stored at ${result.baselinePath}` }] };
    }
  );

  server.tool(
    "check_server",
    "Connect to an MCP server and compare its current tools/list response against the stored baseline. A tool whose description, schema, or annotations changed since baseline is a 'rug pull' — approved once, silently different now. If no baseline exists yet, one is captured automatically (set autoBaseline=false to require an explicit baseline_server call first).",
    { ...targetShape, autoBaseline: z.boolean().optional().describe("Automatically capture a baseline if none exists yet (default: true)") },
    async (args) => {
      const { target, label } = resolveTarget(args);
      const result = await checkServer(target, label, DEFAULT_BASE_DIR, { autoBaseline: args.autoBaseline });
      return { content: [{ type: "text", text: formatCheckResult(result) }] };
    }
  );

  server.tool(
    "list_baselines",
    "List every server this scanner has a stored baseline for",
    {},
    async () => {
      const baselines = listBaselines(DEFAULT_BASE_DIR);
      if (baselines.length === 0) {
        return { content: [{ type: "text", text: "No baselines stored yet. Call baseline_server first." }] };
      }
      const lines = baselines.map((b) => `• ${b.target} — ${Object.keys(b.tools).length} tool(s), captured ${b.capturedAt}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
