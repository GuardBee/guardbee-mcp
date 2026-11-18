#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readPlanUtilization } from "./account.js";
import { detectForeignUsage, formatReport } from "./detect.js";
import { formatUsageReport, usageReport } from "./report.js";
import { recordSnapshot, toSnapshot } from "./snapshots.js";
import type { GroupBy } from "./transcripts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

const HELP = `guardbee-claude-usage-guard ${getVersion()}

Usage:
  guardbee-claude-usage-guard                 Start the MCP server (stdio)
  guardbee-claude-usage-guard detect [--json] Is all plan usage coming from this machine?
  guardbee-claude-usage-guard report [--hours N] [--by session|day|project|entrypoint|model] [--json]
  guardbee-claude-usage-guard snapshot        Store the current plan reading (schedule it, e.g. hourly cron)
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const json = args.includes("--json");
  switch (command) {
    case undefined: {
      const { startServer } = await import("./server.js");
      await startServer();
      return;
    }
    case "detect": {
      const report = detectForeignUsage();
      console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
      process.exitCode = report.verdict === "likely-other-usage" ? 2 : 0;
      return;
    }
    case "report": {
      const hours = flag(args, "--hours");
      const report = usageReport({ hours: hours ? Number(hours) : undefined, groupBy: flag(args, "--by") as GroupBy | undefined });
      console.log(json ? JSON.stringify(report, null, 2) : formatUsageReport(report));
      return;
    }
    case "snapshot": {
      const plan = readPlanUtilization();
      if (!plan) {
        console.error("No cached plan utilization in Claude Code's config; run /usage in Claude Code once.");
        process.exitCode = 1;
        return;
      }
      console.log(recordSnapshot(toSnapshot(plan)) ? "recorded" : "unchanged since last snapshot");
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
