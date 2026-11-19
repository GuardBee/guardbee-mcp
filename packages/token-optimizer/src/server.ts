import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { compact, formatHookResult, listTaggedHooks, uninstallHooks } from "@guardbee/mcp-claude-usage-guard";
import { z } from "zod";
import { auditMcpServers, disableMcpServers, listParked, restoreMcpServers, type McpServerEntry, type ToggleResult } from "./mcp.js";
import { formatRecommendations, optimizationReport } from "./optimize.js";
import { configuredServers, formatDefinitionCosts, measureDefinitions, saveDefinitionCosts } from "./mcp-defs.js";
import { CONTEXT_HOOK_TAG, DEFAULT_THRESHOLD, installContextHooks } from "./context-hook.js";
import { packageVersion } from "./version.js";
import { listSessions, stopSessions, type SessionInfo, type StopResult } from "./sessions.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function duration(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d${Math.floor((seconds % 86400) / 3600)}h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 60)}m`;
}

export function formatSessions(sessions: SessionInfo[]): string {
  if (sessions.length === 0) return "No Claude Code processes running.";
  const lines = ["pid     tty      up      cpu   status  context  24h weighted  cwd"];
  for (const s of sessions) {
    lines.push(
      `${String(s.pid).padEnd(7)} ${s.tty.padEnd(8)} ${duration(s.elapsedSeconds).padEnd(7)} ${s.cpu.toFixed(1).padStart(4)}  ${(s.status ?? "?").padEnd(6)}  ${compact(s.currentContext).padStart(7)}  ${compact(s.recentWeighted).padStart(12)}  ${s.cwd ?? "?"}${s.isSelf ? "  (this session)" : ""}`
    );
  }
  return lines.join("\n");
}

export function formatStop(results: StopResult[], dryRun: boolean): string {
  if (results.length === 0) return "No sessions matched.";
  const lines = results.map((r) => `pid ${r.pid}: ${r.action}${r.reason ? ` (${r.reason})` : ""}`);
  if (dryRun) lines.push("", "Dry run: nothing was stopped. Call again with dryRun: false to stop them.");
  else lines.push("", "Transcripts are kept; `claude --resume` reopens a stopped session.");
  return lines.join("\n");
}

export function formatMcpAudit(servers: McpServerEntry[]): string {
  if (servers.length === 0) return "No MCP servers configured or used.";
  const lines = ["server                              scope      calls  output    last used   status"];
  for (const s of servers) {
    lines.push(
      `${s.name.slice(0, 35).padEnd(35)} ${s.scope.padEnd(10)} ${String(s.calls).padStart(5)}  ${compact(s.resultChars / 4).padStart(6)}t  ${(s.lastUsed ? new Date(s.lastUsed).toISOString().slice(0, 10) : "never").padEnd(10)}  ${s.disabled ? "disabled" : s.toggleable ? "on" : "on (not local)"}${s.project ? `  ${s.project}` : ""}`
    );
  }
  return lines.join("\n");
}

export function formatToggle(results: ToggleResult[], dryRun: boolean): string {
  const lines = results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name} (${r.scope}): ${r.message}${r.backup ? ` [backup ${r.backup}]` : ""}`);
  if (dryRun) lines.push("", "Dry run: config unchanged. Call again with dryRun: false to apply.");
  else if (results.some((r) => r.ok))
    lines.push("", "Applies to Claude Code sessions started from now on. Restart open sessions; a running session may write its own copy of ~/.claude.json back on exit, so check with audit_mcp_servers afterwards.");
  return lines.join("\n");
}

const toggleShape = z.object({
  servers: z
    .array(
      z.object({
        name: z.string(),
        scope: z.enum(["user", "local", "project", "plugin", "external"]),
        project: z.string().optional().describe("Project directory, for local and project scope"),
      })
    )
    .min(1),
  dryRun: z.boolean().optional().describe("Default true: show the change without writing it"),
});

export async function startServer() {
  serveStdio(() => {
    const server = new McpServer({ name: "guardbee-token-optimizer", version: packageVersion() });
    instrumentServer(server, "token-optimizer");
    registerTools(server);
    return server;
  });
}

/** This package's MCP tools on `server`; @guardbee/security-suite serves several packages' tools from one process this way. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "optimize_report",
    {
      description:
        "Find what is burning Claude Code tokens on this machine and what to do about it: sessions with oversized contexts, file reads and MCP servers that flood the context, unused MCP servers, idle sessions, subagent and model mix.",
      inputSchema: z.object({
        hours: z.number().min(1).max(24 * 30).optional().describe("Look-back window (default 24)"),
        contextThreshold: z.number().min(10_000).optional().describe("Context size that warrants /compact (default 150000)"),
      }),
    },
    async ({ hours, contextThreshold }) => text(formatRecommendations(optimizationReport({ hours, contextThreshold })))
  );

  server.registerTool(
    "list_sessions",
    {
      description: "Running Claude Code processes on this machine with uptime, CPU, busy/idle status, current context size and recent token spend.",
      inputSchema: z.object({ hours: z.number().min(1).max(24 * 30).optional() }),
    },
    async ({ hours }) => text(formatSessions(listSessions({ hours })))
  );

  server.registerTool(
    "stop_sessions",
    {
      description:
        "Stop Claude Code sessions by pid, or every session idle for longer than idleHours. Dry run by default. Sends SIGTERM (transcripts are kept, `claude --resume` reopens them) and never stops the session that runs this tool.",
      inputSchema: z.object({
        pids: z.array(z.number().int()).optional(),
        idleHours: z.number().min(0.5).optional(),
        dryRun: z.boolean().optional().describe("Default true"),
      }),
    },
    async ({ pids, idleHours, dryRun }) => {
      if (!pids?.length && idleHours === undefined) return text("Pass pids or idleHours.");
      return text(formatStop(stopSessions({ pids, idleHours, dryRun }), dryRun !== false));
    }
  );

  server.registerTool(
    "audit_mcp_servers",
    {
      description:
        "Every MCP server Claude Code loads (user, local, project .mcp.json, plugins, plus claude.ai connectors and built-ins seen in transcripts) with how often its tools ran and how much output they put into context.",
      inputSchema: z.object({
        project: z.string().optional().describe("Only this project's local/.mcp.json servers"),
        hours: z.number().min(1).max(24 * 90).optional().describe("Look-back window (default 168)"),
      }),
    },
    async ({ project, hours }) => text(formatMcpAudit(auditMcpServers({ project, hours })))
  );

  server.registerTool(
    "disable_mcp_servers",
    {
      description:
        "Turn MCP servers off for new Claude Code sessions without losing their config: plugins and .mcp.json servers via Claude Code's own disable lists, user/local servers by parking their entry for restore_mcp_servers. Dry run by default; backs up the config before writing.",
      inputSchema: toggleShape,
    },
    async ({ servers, dryRun }) => text(formatToggle(disableMcpServers(servers, { dryRun }), dryRun !== false))
  );

  server.registerTool(
    "measure_mcp_definitions",
    {
      description:
        "Start each configured MCP server the way Claude Code does, list its tools, and measure how many tokens their names, descriptions and input schemas take. Runs the servers' configured commands; results are stored for optimize_report.",
      inputSchema: z.object({
        servers: z.array(z.string()).optional().describe("Only these server names (default: every enabled server)"),
        project: z.string().optional().describe("Only this project's local/.mcp.json servers, plus user and plugin servers"),
        timeoutSeconds: z.number().min(2).max(120).optional().describe("Per server (default 20)"),
      }),
    },
    async ({ servers, project, timeoutSeconds }) => {
      let targets = configuredServers({ project }).filter((s) => !s.disabled);
      if (servers?.length) targets = targets.filter((s) => servers.includes(s.name));
      const costs = await measureDefinitions(targets, (timeoutSeconds ?? 20) * 1000);
      saveDefinitionCosts(costs);
      return text(formatDefinitionCosts(costs));
    }
  );

  server.registerTool(
    "install_hooks",
    {
      description: `Add a Claude Code hook (UserPromptSubmit, and SessionStart on resume) that warns you when a session's context passes a threshold (default ${DEFAULT_THRESHOLD}), then again every further 100k, with the per-message plan cost when calibrated. Leaves other hooks untouched; backs up settings.json. Dry run by default.`,
      inputSchema: z.object({
        threshold: z.number().min(20_000).optional(),
        lang: z.enum(["en", "tr"]).optional().describe("Warning language (default en)"),
        dryRun: z.boolean().optional().describe("Default true"),
      }),
    },
    async ({ threshold, lang, dryRun }) =>
      text(formatHookResult(installContextHooks({ apply: dryRun === false, scriptPath: process.argv[1], version: packageVersion(), threshold, lang })))
  );

  server.registerTool(
    "uninstall_hooks",
    {
      description: "Remove the context-warning hooks install_hooks added, and nothing else. Dry run by default.",
      inputSchema: z.object({ dryRun: z.boolean().optional().describe("Default true") }),
    },
    async ({ dryRun }) => {
      if (!listTaggedHooks(CONTEXT_HOOK_TAG).length) return text("No token-optimizer hooks installed.");
      return text(formatHookResult(uninstallHooks(CONTEXT_HOOK_TAG, { apply: dryRun === false })));
    }
  );

  server.registerTool(
    "restore_mcp_servers",
    {
      description: "Turn back on MCP servers disabled with disable_mcp_servers. Dry run by default. With no servers given, lists what is parked.",
      inputSchema: toggleShape.partial({ servers: true }),
    },
    async ({ servers, dryRun }) => {
      if (!servers?.length) {
        const parked = listParked();
        return text(parked.length ? parked.map((p) => `${p.name} (${p.scope}${p.project ? `, ${p.project}` : ""}) parked ${new Date(p.parkedAt).toISOString()}`).join("\n") : "Nothing parked.");
      }
      return text(formatToggle(restoreMcpServers(servers, { dryRun }), dryRun !== false));
    }
  );
}
