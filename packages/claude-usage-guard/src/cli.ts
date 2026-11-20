#!/usr/bin/env node
import { readPlanUtilization } from "./account.js";
import { checkForeignUsage, notifyDesktop, type AlarmLang } from "./alarm.js";
import { packageVersion } from "./version.js";
import { detectForeignUsage, formatReport } from "./detect.js";
import { formatForecast, planForecast } from "./forecast.js";
import { formatHookResult, readHookInput, uninstallHooks } from "./hooks.js";
import { HOOK_TAG, installUsageGuardHooks } from "./install.js";
import { formatUsageReport, usageReport } from "./report.js";
import { recordSnapshot, toSnapshot } from "./snapshots.js";
import type { GroupBy } from "./transcripts.js";

const getVersion = packageVersion;

const HELP = `guardbee-claude-usage-guard ${getVersion()}

Usage:
  guardbee-claude-usage-guard                 Start the MCP server (stdio)
  guardbee-claude-usage-guard detect [--json] Is all plan usage coming from this machine?
  guardbee-claude-usage-guard report [--hours N] [--by session|day|project|entrypoint|model] [--json]
  guardbee-claude-usage-guard forecast        Plan meters, current pace, and when the limit would be hit
  guardbee-claude-usage-guard snapshot        Store the current plan reading
  guardbee-claude-usage-guard install-hooks [--lang en|tr] [--notify] [--apply]
                                              Record plan readings from Claude Code hooks and alert on
                                              usage this machine does not explain (--notify: desktop too)
  guardbee-claude-usage-guard uninstall-hooks [--apply]
  guardbee-claude-usage-guard hook [--lang en|tr] [--notify]   (run by the hooks) record, alert if needed

install-hooks and uninstall-hooks are dry runs unless --apply is given.
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
    case "forecast":
      console.log(formatForecast(planForecast()));
      return;
    case "hook": {
      // Runs inside Claude Code on every session start and turn end: print only an alarm, never fail
      await readHookInput();
      try {
        const plan = readPlanUtilization();
        if (plan) recordSnapshot(toSnapshot(plan));
        const { message } = checkForeignUsage({ lang: flag(args, "--lang") as AlarmLang | undefined });
        if (message) {
          process.stdout.write(JSON.stringify({ systemMessage: message }));
          if (args.includes("--notify")) notifyDesktop(message);
        }
      } catch {
        // a hook must not disturb the session
      }
      return;
    }
    case "install-hooks":
      console.log(
        formatHookResult(
          installUsageGuardHooks({
            apply: args.includes("--apply"),
            scriptPath: process.argv[1],
            version: getVersion(),
            lang: flag(args, "--lang") as AlarmLang | undefined,
            notify: args.includes("--notify"),
          })
        )
      );
      return;
    case "uninstall-hooks":
      console.log(formatHookResult(uninstallHooks(HOOK_TAG, { apply: args.includes("--apply") })));
      return;
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
