#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { auditMcpServers, disableMcpServers, restoreMcpServers, type McpScope } from "./mcp.js";
import { formatRecommendations, optimizationReport } from "./optimize.js";
import { formatMcpAudit, formatSessions, formatStop, formatToggle } from "./server.js";
import { listSessions, stopSessions } from "./sessions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

const HELP = `guardbee-token-optimizer ${getVersion()}

Usage:
  guardbee-token-optimizer                       Start the MCP server (stdio)
  guardbee-token-optimizer report [--hours N]    What is burning tokens, and what to do
  guardbee-token-optimizer sessions              Running Claude Code sessions
  guardbee-token-optimizer stop <pid...> | --idle-hours N   [--apply]
  guardbee-token-optimizer mcp [--project DIR] [--hours N]
  guardbee-token-optimizer disable <scope> <name> [--project DIR] [--apply]
  guardbee-token-optimizer restore <scope> <name> [--project DIR] [--apply]

Changes are dry runs unless --apply is given. Scopes: user, local, project, plugin.
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
