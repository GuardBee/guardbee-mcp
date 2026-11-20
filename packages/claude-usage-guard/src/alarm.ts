import { spawn } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { readAccount, readPlanUtilization } from "./account.js";
import { analyseIntervals, buildIntervals, type UsageInterval } from "./detect.js";
import { resolvePaths, type ClaudePaths } from "./paths.js";
import { readSnapshots } from "./snapshots.js";
import { scanTranscripts } from "./transcripts.js";

export type AlarmLang = "en" | "tr";

export interface AlarmState {
  /** Snapshot count at the last check; nothing new to analyse until it changes */
  checkedSnapshots?: number;
  /** End of the newest interval already alerted on */
  alertedTo?: number;
  /** Plan fetch time whose account mismatch was already alerted on */
  alertedMismatch?: number;
  /** Learned at the last check, so the status line can price a message without scanning */
  tokensPerPct?: Partial<Record<UsageInterval["window"], number>>;
  lastAlert?: { at: number; message: string };
}

export interface AlarmResult {
  message?: string;
  flagged: UsageInterval[];
  checked: boolean;
}

const DAY = 86_400_000;
// On the first check, older history is reported by `detect`, not pushed as a fresh alarm
const FIRST_RUN_LOOKBACK = DAY;

export function alarmStateFile(paths?: Partial<ClaudePaths>): string {
  return join(resolvePaths(paths).stateDir, "alarm.json");
}

export function readAlarmState(paths?: Partial<ClaudePaths>): AlarmState {
  try {
    return JSON.parse(readFileSync(alarmStateFile(paths), "utf8")) as AlarmState;
  } catch {
    return {};
  }
}

function writeAlarmState(state: AlarmState, paths?: Partial<ClaudePaths>): void {
  mkdirSync(resolvePaths(paths).stateDir, { recursive: true });
  writeFileSync(alarmStateFile(paths), JSON.stringify(state), { mode: 0o600 });
}

function when(ms: number, lang: AlarmLang): string {
  return new Date(ms).toLocaleString(lang === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pt(value: number, lang: AlarmLang): string {
  const s = value.toFixed(1);
  return lang === "tr" ? s.replace(".", ",") : s;
}

export function alarmMessage(flagged: UsageInterval[], lang: AlarmLang): string {
  const rise = flagged.reduce((s, iv) => s + iv.deltaPct, 0);
  const unexplained = flagged.reduce((s, iv) => s + iv.unexplainedPct, 0);
  const from = when(flagged[0].from, lang);
  const to = when(flagged[flagged.length - 1].to, lang);
  const idle = flagged.every((iv) => iv.explainedPct === undefined);
  if (lang === "tr") {
    return (
      `🚨 GuardBee: Plan sayacı ${from} – ${to} arasında ${pt(rise, lang)} puan arttı; ` +
      (idle ? "bu makinedeki Claude Code o sırada boştaydı. " : `bu makinedeki Claude Code bunun ~${pt(rise - unexplained, lang)} puanını açıklıyor. `) +
      "Kullanım başka bir yerden geliyor: başka bir cihaz ya da kişi, veya senin claude.ai web/masaüstü/mobil sohbetlerin (aynı limiti paylaşır). " +
      "Sen değilsen claude.ai'de şifreni değiştir ve diğer oturumları kapat. Ayrıntı: guardbee-claude-usage-guard detect"
    );
  }
  return (
    `🚨 GuardBee: the plan meter rose ${pt(rise, lang)} pt between ${from} and ${to}; ` +
    (idle ? "Claude Code on this machine was idle then. " : `Claude Code on this machine accounts for ~${pt(rise - unexplained, lang)} pt of it. `) +
    "That usage came from elsewhere: another device or person, or your own claude.ai web/desktop/mobile chats (they share the limit). " +
    "If it was not you, change your claude.ai password and sign out other sessions. Details: guardbee-claude-usage-guard detect"
  );
}

function mismatchMessage(lang: AlarmLang): string {
  return lang === "tr"
    ? "🚨 GuardBee: Önbellekteki plan okuması, şu an oturum açık olan hesaptan farklı bir hesaba ait. Bu makinede hesap değiştirilmiş."
    : "🚨 GuardBee: the cached plan reading belongs to a different account than the one signed in now. Someone switched logins on this machine.";
}

/**
 * Checks the newest plan readings for usage this machine does not explain and returns an alarm the
 * first time each such stretch is seen. Cheap when there is nothing new: it only scans transcripts
 * after a new reading has been stored.
 */
export function checkForeignUsage(
  options: { paths?: Partial<ClaudePaths>; now?: number; lang?: AlarmLang; minUnexplainedPct?: number } = {}
): AlarmResult {
  const now = options.now ?? Date.now();
  const lang = options.lang ?? "en";
  const state = readAlarmState(options.paths);
  const snapshots = readSnapshots(options.paths).filter((s) => s.at >= now - 7 * DAY);
  const messages: string[] = [];

  const plan = readPlanUtilization(options.paths);
  const account = readAccount(options.paths);
  if (plan?.accountUuid && account?.accountUuid && plan.accountUuid !== account.accountUuid && state.alertedMismatch !== plan.fetchedAt) {
    state.alertedMismatch = plan.fetchedAt;
    messages.push(mismatchMessage(lang));
  }

  let flagged: UsageInterval[] = [];
  const checked = snapshots.length !== state.checkedSnapshots;
  if (checked) {
    const since = snapshots.length ? Math.min(snapshots[0].at, now - 7 * DAY) : now - 7 * DAY;
    const { usage } = scanTranscripts({ paths: options.paths, sinceMs: since });
    const { intervals, tokensPerPct } = analyseIntervals(buildIntervals(snapshots, usage), options.minUnexplainedPct);
    const after = state.alertedTo ?? (state.checkedSnapshots === undefined ? now - FIRST_RUN_LOOKBACK : 0);
    flagged = intervals.filter((iv) => iv.flagged && iv.to > after);
    if (flagged.length) {
      state.alertedTo = flagged[flagged.length - 1].to;
      messages.push(alarmMessage(flagged, lang));
    }
    state.checkedSnapshots = snapshots.length;
    state.tokensPerPct = tokensPerPct;
  }

  const message = messages.length ? messages.join("\n") : undefined;
  if (message) state.lastAlert = { at: now, message };
  if (checked || message) writeAlarmState(state, options.paths);
  return { message, flagged, checked };
}

/** A desktop notification, best effort: osascript on macOS, notify-send on Linux. */
export function notifyDesktop(message: string, platform: NodeJS.Platform = process.platform): void {
  let command: string;
  let args: string[];
  if (platform === "darwin") {
    // The text goes in as an argument, never into the script, so quotes in it cannot break out
    command = "osascript";
    args = ["-e", "on run argv", "-e", 'display notification (item 1 of argv) with title "GuardBee"', "-e", "end run", message];
  } else if (platform === "linux") {
    command = "notify-send";
    args = ["GuardBee", message];
  } else {
    return;
  }
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // no notifier on this system
  }
}
