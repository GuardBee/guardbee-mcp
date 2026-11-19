#!/usr/bin/env node
import { auditMcpServers, disableMcpServers, restoreMcpServers, type McpScope } from "./mcp.js";
import { formatRecommendations, optimizationReport } from "./optimize.js";
import { formatMcpAudit, formatSessions, formatStop, formatToggle } from "./server.js";
import { listSessions, stopSessions } from "./sessions.js";
import { formatHookResult, readHookInput, uninstallHooks } from "@guardbee/mcp-claude-usage-guard";
import { CONTEXT_HOOK_TAG, contextHook, installContextHooks, planPctFromCalibration, type Lang } from "./context-hook.js";
import { configuredServers, formatDefinitionCosts, measureDefinitions, saveDefinitionCosts } from "./mcp-defs.js";
import { packageVersion } from "./version.js";

const getVersion = packageVersion;

const HELP = `guardbee-token-optimizer ${getVersion()}

Usage:
  guardbee-token-optimizer                       Start the MCP server (stdio)
  guardbee-token-optimizer report [--hours N]    What is burning tokens, and what to do
  guardbee-token-optimizer sessions              Running Claude Code sessions
  guardbee-token-optimizer stop <pid...> | --idle-hours N   [--apply]
  guardbee-token-optimizer mcp [--project DIR] [--hours N]
  guardbee-token-optimizer disable <scope> <name> [--project DIR] [--apply]
  guardbee-token-optimizer restore <scope> <name> [--project DIR] [--apply]
  guardbee-token-optimizer measure-mcp [--project DIR] [--timeout SECONDS]   Tool-definition cost per MCP server
  guardbee-token-optimizer install-hooks [--threshold N] [--lang en|tr] [--apply]   Warn when a session's context grows past N
  guardbee-token-optimizer uninstall-hooks [--apply]
  guardbee-token-optimizer hook [--threshold N] [--lang en|tr]   (run by the hooks)

Changes (stop, disable, restore, install-hooks, uninstall-hooks) are dry runs unless --apply is given.
Scopes: user, local, project, plugin. measure-mcp starts the configured MCP servers to list their tools.
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function num(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const apply = args.includes("--apply");
  switch (command) {
    case undefined: {
      const { startServer } = await import("./server.js");
      await startServer();
      return;
    }
    case "report":
      console.log(formatRecommendations(optimizationReport({ hours: num(flag(args, "--hours")) })));
      return;
    case "sessions":
      console.log(formatSessions(listSessions()));
      return;
    case "stop": {
      const pids = args.filter((a) => /^\d+$/.test(a) && args[args.indexOf(a) - 1] !== "--idle-hours").map(Number);
      const idleHours = num(flag(args, "--idle-hours"));
      if (!pids.length && idleHours === undefined) {
        console.log(HELP);
        process.exitCode = 1;
        return;
      }
      console.log(formatStop(stopSessions({ pids, idleHours, dryRun: !apply }), !apply));
      return;
    }
    case "mcp":
      console.log(formatMcpAudit(auditMcpServers({ project: flag(args, "--project"), hours: num(flag(args, "--hours")) })));
      return;
    case "disable":
    case "restore": {
      const [scope, name] = args;
      if (!scope || !name) {
        console.log(HELP);
        process.exitCode = 1;
        return;
      }
      const request = [{ scope: scope as McpScope, name, project: flag(args, "--project") }];
      const results = command === "disable" ? disableMcpServers(request, { dryRun: !apply }) : restoreMcpServers(request, { dryRun: !apply });
      console.log(formatToggle(results, !apply));
      process.exitCode = results.every((r) => r.ok) ? 0 : 1;
      return;
    }
    case "measure-mcp": {
      const timeout = num(flag(args, "--timeout"));
      const costs = await measureDefinitions(configuredServers({ project: flag(args, "--project") }).filter((s) => !s.disabled), (timeout ?? 20) * 1000);
      saveDefinitionCosts(costs);
      console.log(formatDefinitionCosts(costs));
      return;
    }
    case "install-hooks":
      console.log(formatHookResult(installContextHooks({ apply, scriptPath: process.argv[1], version: getVersion(), threshold: num(flag(args, "--threshold")), lang: flag(args, "--lang") as Lang | undefined })));
      return;
    case "uninstall-hooks":
      console.log(formatHookResult(uninstallHooks(CONTEXT_HOOK_TAG, { apply })));
      return;
    case "hook": {
      // Runs inside Claude Code before every prompt: print only the hook's JSON, never fail
      try {
        const input = await readHookInput();
        const out = contextHook(input, { threshold: num(flag(args, "--threshold")), lang: flag(args, "--lang") as Lang | undefined, planPct: planPctFromCalibration() });
        if (out) process.stdout.write(JSON.stringify(out));
      } catch {
        // a hook must not disturb the session
      }
      return;
    }
    case "--version":
    case "-v":
      console.log(getVersion());
      return;
    default:
      console.log(HELP);
      process.exitCode = command === "--help" || command === "-h" ? 0 : 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
