import { installHooks, selfCommand, type HookInstallResult } from "./hooks.js";
import type { AlarmLang } from "./alarm.js";
import type { ClaudePaths } from "./paths.js";

export const HOOK_TAG = "guardbee:claude-usage-guard";
export const PACKAGE_NAME = "@guardbee/mcp-claude-usage-guard";

/**
 * Records a plan reading whenever a Claude Code session starts and after every turn, so detection
 * and forecasts have a history without a cron job, and raises the foreign-usage alarm when a new
 * reading shows usage this machine does not explain. Readings are deduplicated by fetch time.
 */
export function installUsageGuardHooks(options: {
  paths?: Partial<ClaudePaths>;
  apply?: boolean;
  scriptPath?: string;
  version: string;
  lang?: AlarmLang;
  /** Also show the alarm as a desktop notification */
  notify?: boolean;
}): HookInstallResult {
  const flags = [options.lang && options.lang !== "en" ? `--lang ${options.lang}` : "", options.notify ? "--notify" : ""].filter(Boolean).join(" ");
  const command = `${selfCommand(options.scriptPath, PACKAGE_NAME, options.version)} hook${flags ? ` ${flags}` : ""}`;
  return installHooks(
    [
      { event: "SessionStart", command, timeout: 10 },
      { event: "Stop", command, timeout: 10 },
    ],
    HOOK_TAG,
    { paths: options.paths, apply: options.apply }
  );
}
