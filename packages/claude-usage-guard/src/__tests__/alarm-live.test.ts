import { describe, expect, it } from "vitest";
import { readFileSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { alarmMessage, checkForeignUsage, readAlarmState } from "../alarm.js";
import { buildIntervals } from "../detect.js";
import { installStatusLine, uninstallStatusLine } from "../hooks.js";
import { installUsageGuardHooks } from "../install.js";
import { recordLiveReading, snapshotFromRateLimits } from "../live.js";
import { readSnapshots, recordSnapshot, sameReset } from "../snapshots.js";
import { assistantLines, tempClaude, writeClaudeJson, writeTranscript } from "./fixtures.js";

const H = 3_600_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const RESET_S = Date.parse("2026-11-20T15:00:00Z") / 1000;

function rateLimits(five: number, seven: number) {
  return { five_hour: { used_percentage: five, resets_at: RESET_S }, seven_day: { used_percentage: seven, resets_at: RESET_S + 4 * 86_400 } };
}

describe("live readings from the status line", () => {
  it("converts rate_limits, with epoch-second resets", () => {
    const s = snapshotFromRateLimits(rateLimits(23.5, 41), NOW)!;
    expect(s).toMatchObject({ at: NOW, fiveHour: 23.5, sevenDay: 41, fiveHourResetsAt: "2026-11-20T15:00:00.000Z" });
    expect(snapshotFromRateLimits(undefined, NOW)).toBeUndefined();
    expect(snapshotFromRateLimits({ five_hour: {} }, NOW)).toBeUndefined();
  });

  it("stores fresh readings when the meter moves or the last one is old, and skips stale ones", () => {
    const paths = tempClaude();
    const transcript = writeTranscript(paths, "-w", "s1", ["{}"]);
    utimesSync(transcript, new Date(NOW), new Date(NOW));
    const input = (five: number) => ({ transcript_path: transcript, rate_limits: rateLimits(five, 40) });
    expect(recordLiveReading(input(20), { paths, now: NOW })).toBe(true);
    expect(recordLiveReading(input(20), { paths, now: NOW + 30_000 })).toBe(false);
    expect(recordLiveReading(input(21), { paths, now: NOW + 40_000 })).toBe(true);
    // Transcript untouched for minutes: the meter is from an old response
    expect(recordLiveReading(input(25), { paths, now: NOW + 5 * 60_000 })).toBe(false);
    utimesSync(transcript, new Date(NOW + 15 * 60_000), new Date(NOW + 15 * 60_000));
    expect(recordLiveReading(input(21), { paths, now: NOW + 15 * 60_000 })).toBe(true);
    expect(readSnapshots(paths).map((s) => s.fiveHour)).toEqual([20, 21, 21]);
  });

  it("matches reset times written differently by the status line and the cache", () => {
    expect(sameReset("2026-11-20T15:00:00.000Z", "2026-11-20T15:00:00.412+00:00")).toBe(true);
    expect(sameReset("2026-11-20T15:00:00Z", "2026-11-20T20:00:00Z")).toBe(false);
    expect(sameReset(undefined, "2026-11-20T15:00:00Z")).toBe(false);
    const intervals = buildIntervals(
      [
        { at: NOW, fiveHour: 10, fiveHourResetsAt: "2026-11-20T15:00:00.412+00:00" },
        { at: NOW + H, fiveHour: 14, fiveHourResetsAt: "2026-11-20T15:00:00.000Z" },
      ],
      []
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ window: "five_hour", deltaPct: 4 });
  });
});

describe("foreign-usage alarm", () => {
  function idleRise(paths: ReturnType<typeof tempClaude>) {
    recordSnapshot({ at: NOW - 3 * H, fiveHour: 10, fiveHourResetsAt: "r" }, paths);
    recordSnapshot({ at: NOW - H, fiveHour: 18, fiveHourResetsAt: "r" }, paths);
  }

  it("alarms once when the meter rose while this machine was idle", () => {
    const paths = tempClaude();
    idleRise(paths);
    const first = checkForeignUsage({ paths, now: NOW, lang: "tr" });
    expect(first.flagged).toHaveLength(1);
    expect(first.message).toMatch(/8,0 puan arttı; bu makinedeki Claude Code o sırada boştaydı/);
    expect(readAlarmState(paths).lastAlert?.at).toBe(NOW);
    // Nothing new: no scan, no second alarm
    expect(checkForeignUsage({ paths, now: NOW + 60_000 })).toMatchObject({ checked: false, message: undefined });
    // A new reading that is explained does not repeat the old alarm
    recordSnapshot({ at: NOW, fiveHour: 18, fiveHourResetsAt: "r" }, paths);
    expect(checkForeignUsage({ paths, now: NOW + 120_000 })).toMatchObject({ checked: true, message: undefined });
  });

  it("stays quiet when this machine's own work explains the rise", () => {
    const paths = tempClaude();
    idleRise(paths);
    writeTranscript(paths, "-w", "s1", assistantLines({ ts: NOW - 2 * H, input: 2_000_000 }));
    expect(checkForeignUsage({ paths, now: NOW }).message).toBeUndefined();
  });

  it("does not raise old history as a fresh alarm on the first check", () => {
    const paths = tempClaude();
    recordSnapshot({ at: NOW - 3 * 86_400_000, sevenDay: 10, sevenDayResetsAt: "w" }, paths);
    recordSnapshot({ at: NOW - 2 * 86_400_000, sevenDay: 20, sevenDayResetsAt: "w" }, paths);
    expect(checkForeignUsage({ paths, now: NOW }).message).toBeUndefined();
  });

  it("alarms when the cached reading belongs to another account", () => {
    const paths = tempClaude();
    writeClaudeJson(paths, {
      oauthAccount: { accountUuid: "me" },
      cachedUsageUtilization: { fetchedAtMs: NOW, accountUuid: "someone-else", utilization: { five_hour: { utilization: 5 } } },
    });
    expect(checkForeignUsage({ paths, now: NOW }).message).toMatch(/different account/);
    expect(checkForeignUsage({ paths, now: NOW }).message).toBeUndefined();
  });

  it("speaks English with the explained share", () => {
    const text = alarmMessage([{ from: NOW - H, to: NOW, window: "five_hour", deltaPct: 10, localWeighted: 50_000, explainedPct: 2, unexplainedPct: 7, flagged: true }], "en");
    expect(text).toMatch(/rose 10\.0 pt .* accounts for ~3\.0 pt/);
  });
});

describe("install options", () => {
  it("passes the alarm language and desktop notifications to the hook", () => {
    const paths = tempClaude();
    const result = installUsageGuardHooks({ paths, scriptPath: "/opt/g/cli.js", version: "1.0.0", lang: "tr", notify: true });
    expect(result.changes[0].command).toBe('node "/opt/g/cli.js" hook --lang tr --notify # guardbee:claude-usage-guard');
  });

  it("sets the status line, keeps someone else's unless forced, and removes only its own", () => {
    const paths = tempClaude();
    const file = join(paths.claudeDir, "settings.json");
    writeClaudeJson(paths, {});
    const theirs = { type: "command", command: "~/.claude/mine.sh" };
    writeFileSync(file, JSON.stringify({ statusLine: theirs }));
    const kept = installStatusLine({ command: "x statusline" }, "guardbee:t", { paths, apply: true });
    expect(kept.conflict).toBe("~/.claude/mine.sh");
    expect(JSON.parse(readFileSync(file, "utf8")).statusLine).toEqual(theirs);
    expect(uninstallStatusLine("guardbee:t", { paths, apply: true }).changes).toHaveLength(0);

    const forced = installStatusLine({ command: "x statusline", padding: 0 }, "guardbee:t", { paths, apply: true, force: true });
    expect(forced).toMatchObject({ applied: true, changes: [{ event: "statusLine", action: "replace" }] });
    expect(JSON.parse(readFileSync(file, "utf8")).statusLine).toEqual({ type: "command", command: "x statusline # guardbee:t", padding: 0 });
    expect(uninstallStatusLine("guardbee:t", { paths, apply: true }).applied).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).statusLine).toBeUndefined();
  });
});
