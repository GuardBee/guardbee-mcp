import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { readAccount, readPlanUtilization } from "./account.js";
import { detectForeignUsage, formatReport } from "./detect.js";
import { formatForecast, planForecast } from "./forecast.js";
import { formatHookResult, listTaggedHooks, uninstallHooks } from "./hooks.js";
import { HOOK_TAG, installUsageGuardHooks } from "./install.js";
import { packageVersion } from "./version.js";
import { formatUsageReport, usageReport } from "./report.js";
import { recordSnapshot, toSnapshot } from "./snapshots.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const VERSION = packageVersion();

export async function startServer() {
  serveStdio(() => {
    const server = new McpServer({ name: "guardbee-claude-usage-guard", version: VERSION });
    instrumentServer(server, "claude-usage-guard");
    registerTools(server);
    return server;
  });
}

/** This package's MCP tools on `server`; @guardbee/security-suite serves several packages' tools from one process this way. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "detect_foreign_usage",
    {
      description:
        "Check whether the Claude account's plan usage is all coming from Claude Code on this machine. Compares the plan meter Claude Code caches (/usage) against this machine's transcripts over time, and checks local signals: account switches, SDK/script use of the login, remote logins, background sessions. Records a plan snapshot on each call; needs a few snapshots over hours to calibrate.",
      inputSchema: z.object({
        minUnexplainedPct: z.number().min(1).max(50).optional().describe("Plan-meter points that must go unexplained before an interval is flagged (default 3)"),
      }),
    },
    async ({ minUnexplainedPct }) => text(formatReport(detectForeignUsage({ minUnexplainedPct })))
  );

  server.registerTool(
    "usage_report",
    {
      description:
        "Claude Code token usage on this machine, from local transcripts, grouped by session, day, project, entrypoint or model. Shows cost-weighted tokens (what plan limits track) and each session's peak context size.",
      inputSchema: z.object({
        hours: z.number().min(1).max(24 * 30).optional().describe("Look-back window in hours (default 24)"),
        groupBy: z.enum(["session", "day", "project", "entrypoint", "model"]).optional(),
      }),
    },
    async ({ hours, groupBy }) => text(formatUsageReport(usageReport({ hours, groupBy })))
  );

  server.registerTool(
    "plan_forecast",
    {
      description:
        "The 5-hour and 7-day plan meters, the current pace (from the plan meter across all devices, or this machine's usage once calibrated), and whether the limit will be hit before it resets.",
      inputSchema: z.object({}),
    },
    async () => text(formatForecast(planForecast()))
  );

  server.registerTool(
    "install_hooks",
    {
      description:
        "Add Claude Code hooks (SessionStart and Stop in ~/.claude/settings.json) that record a plan reading automatically, so detect_foreign_usage and plan_forecast have history, and show an alarm when a new reading shows plan usage this machine does not explain. Leaves other hooks untouched; backs up settings.json. Dry run by default.",
      inputSchema: z.object({
        lang: z.enum(["en", "tr"]).optional().describe("Alarm language (default en)"),
        notify: z.boolean().optional().describe("Also raise a desktop notification (macOS, Linux)"),
        dryRun: z.boolean().optional().describe("Default true"),
      }),
    },
    async ({ lang, notify, dryRun }) => text(formatHookResult(installUsageGuardHooks({ apply: dryRun === false, scriptPath: process.argv[1], version: VERSION, lang, notify })))
  );

  server.registerTool(
    "uninstall_hooks",
    {
      description: "Remove the hooks install_hooks added, and nothing else. Dry run by default. With no changes to make, lists what is installed.",
      inputSchema: z.object({ dryRun: z.boolean().optional().describe("Default true") }),
    },
    async ({ dryRun }) => {
      const installed = listTaggedHooks(HOOK_TAG);
      if (!installed.length) return text("No claude-usage-guard hooks installed.");
      return text(formatHookResult(uninstallHooks(HOOK_TAG, { apply: dryRun === false })));
    }
  );

  server.registerTool(
    "account_status",
    {
      description: "Which Claude account Claude Code on this machine is signed in to, and the plan meters (5-hour and 7-day) it last fetched.",
      inputSchema: z.object({}),
    },
    async () => {
      const account = readAccount();
      const plan = readPlanUtilization();
      if (plan) recordSnapshot(toSnapshot(plan));
      const lines = [
        account ? `Signed in as ${account.email ?? "?"}${account.organizationName ? ` (${account.organizationName}, ${account.organizationRole ?? "member"})` : ""}` : "No Claude account login found (API key or not signed in).",
      ];
      if (account?.billingType) lines.push(`Billing: ${account.billingType}${account.rateLimitTier ? `, tier ${account.rateLimitTier}` : ""}`);
      if (plan) {
        lines.push(`Plan meters (fetched ${new Date(plan.fetchedAt).toISOString()}):`);
        if (plan.fiveHour) lines.push(`  5-hour: ${plan.fiveHour.utilization}% (resets ${plan.fiveHour.resetsAt ?? "?"})`);
        if (plan.sevenDay) lines.push(`  7-day : ${plan.sevenDay.utilization}% (resets ${plan.sevenDay.resetsAt ?? "?"})`);
      } else lines.push("No cached plan meters; run /usage in Claude Code once.");
      return text(lines.join("\n"));
    }
  );
}
