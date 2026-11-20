import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { calibrate, forecastWindow, planForecast } from "../forecast.js";
import { installHooks, listTaggedHooks, readHookInput, selfCommand, uninstallHooks } from "../hooks.js";
import { installUsageGuardHooks } from "../install.js";
import { usageReport, formatUsageReport } from "../report.js";
import { recordSnapshot, type UsageSnapshot } from "../snapshots.js";
import { assistantLines, planCache, tempClaude, writeClaudeJson, writeTranscript } from "./fixtures.js";

const H = 3_600_000;
const T0 = Date.parse("2026-11-18T10:00:00Z");
const RESET = "2026-11-18T14:00:00Z";

function settingsWith(paths: ReturnType<typeof tempClaude>, value: unknown): string {
  const file = join(paths.claudeDir, "settings.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}

const theirs = { type: "command", command: "/bin/sh their-hook.sh" };

describe("installHooks", () => {
  it("is a dry run unless applied", () => {
    const paths = tempClaude();
    const file = settingsWith(paths, { theme: "dark" });
    const result = installHooks([{ event: "Stop", command: "x hook" }], "guardbee:t", { paths });
    expect(result.applied).toBe(false);
    expect(result.changes).toEqual([{ event: "Stop", action: "add", command: "x hook # guardbee:t" }]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark" });
  });

  it("adds next to existing hooks, replaces its own on reinstall, and backs up", () => {
    const paths = tempClaude();
    const file = settingsWith(paths, { theme: "dark", hooks: { Stop: [{ hooks: [theirs] }] } });
    installHooks([{ event: "Stop", command: "x hook", timeout: 10 }, { event: "SessionStart", command: "x hook", matcher: "resume" }], "guardbee:t", { paths, apply: true });
    const again = installHooks([{ event: "Stop", command: "y hook" }], "guardbee:t", { paths, apply: true });
    expect(again.changes[0].action).toBe("replace");
    expect(again.backup && existsSync(again.backup)).toBe(true);
    const settings = JSON.parse(readFileSync(file, "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.Stop).toEqual([{ hooks: [theirs] }, { hooks: [{ type: "command", command: "y hook # guardbee:t" }] }]);
    expect(settings.hooks.SessionStart).toBeUndefined();
  });

  it("uninstalls only its own entries and drops emptied events", () => {
    const paths = tempClaude();
    const file = settingsWith(paths, { hooks: { Stop: [{ hooks: [theirs, { type: "command", command: "x # guardbee:t" }] }], SessionStart: [{ hooks: [{ type: "command", command: "x # guardbee:t" }] }] } });
    expect(listTaggedHooks("guardbee:t", paths)).toHaveLength(2);
    const result = uninstallHooks("guardbee:t", { paths, apply: true });
    expect(result.changes.map((c) => c.event).sort()).toEqual(["SessionStart", "Stop"]);
    expect(JSON.parse(readFileSync(file, "utf8")).hooks).toEqual({ Stop: [{ hooks: [theirs] }] });
  });

  it("creates settings.json when there is none", () => {
    const paths = tempClaude();
    installUsageGuardHooks({ paths, apply: true, scriptPath: "/opt/g/cli.js", version: "1.2.3" });
    const settings = JSON.parse(readFileSync(join(paths.claudeDir, "settings.json"), "utf8"));
    expect(Object.keys(settings.hooks).sort()).toEqual(["SessionStart", "Stop"]);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('node "/opt/g/cli.js" hook # guardbee:claude-usage-guard');
  });

  it("pins the version when run from the npx cache", () => {
    expect(selfCommand("/Users/me/.npm/_npx/abc/node_modules/x/dist/cli.js", "@guardbee/x", "0.2.0")).toBe("npx -y @guardbee/x@0.2.0");
    expect(selfCommand("/usr/local/lib/node_modules/x/dist/cli.js", "@guardbee/x", "0.2.0")).toBe('node "/usr/local/lib/node_modules/x/dist/cli.js"');
  });
});

describe("readHookInput", () => {
  it("parses JSON from stdin and tolerates garbage", async () => {
    expect(await readHookInput(Readable.from(['{"session_id":"s"}']))).toEqual({ session_id: "s" });
    expect(await readHookInput(Readable.from(["nope"]))).toEqual({});
  });
});

describe("forecast", () => {
  const snap = (at: number, fiveHour: number): UsageSnapshot => ({ at, fiveHour, fiveHourResetsAt: RESET });

  it("takes the pace from the plan meter and warns before the reset", () => {
    const calibration = { tokensPerPct: {}, snapshots: [snap(T0, 20), snap(T0 + H, 50)], usage: [] };
    const f = forecastWindow("five_hour", { utilization: 50, resetsAt: RESET }, T0 + H, calibration, T0 + H);
    expect(f.basis).toBe("plan-meter");
    expect(f.pctPerHour).toBeCloseTo(30);
    expect(f.limitAt).toBe(T0 + H + (50 / 30) * H);
  });

  it("says the limit holds when the pace is slow", () => {
    const calibration = { tokensPerPct: {}, snapshots: [snap(T0, 10), snap(T0 + H, 12)], usage: [] };
    const f = forecastWindow("five_hour", { utilization: 12, resetsAt: RESET }, T0 + H, calibration, T0 + H);
    expect(f.limitAt).toBeUndefined();
    expect(f.atReset).toBeCloseTo(18);
  });

  it("falls back to this machine's usage once calibrated", () => {
    const usage = [{ ts: T0 - 10 * 60_000, sessionId: "s", project: "", model: "claude-opus-5-5", entrypoint: "cli", isSidechain: false, input: 200_000, output: 0, cacheRead: 0, cacheWrite: 0 }];
    const f = forecastWindow("five_hour", { utilization: 40, resetsAt: RESET }, T0, { tokensPerPct: { five_hour: 100_000 }, snapshots: [], usage }, T0);
    expect(f.basis).toBe("local-usage");
    expect(f.pctPerHour).toBeCloseTo(2);
  });

  it("marks a reading from before the last reset as stale", () => {
    const f = forecastWindow("five_hour", { utilization: 70, resetsAt: RESET }, T0, { tokensPerPct: {}, snapshots: [], usage: [] }, Date.parse(RESET) + 1);
    expect(f.stale).toBe(true);
    expect(f.pctPerHour).toBeUndefined();
  });

  it("reads the plan from Claude Code's cache end to end", () => {
    const paths = tempClaude();
    writeClaudeJson(paths, { cachedUsageUtilization: planCache(T0 + H, 40, 50) });
    recordSnapshot({ at: T0, fiveHour: 20, fiveHourResetsAt: "2026-11-18T20:00:00Z" }, paths);
    const f = planForecast({ paths, now: T0 + H });
    expect(f.windows[0]).toMatchObject({ window: "five_hour", basis: "plan-meter" });
    expect(f.windows[0].pctPerHour).toBeCloseTo(20);
  });
});

describe("plan % in the usage report", () => {
  it("adds a column once calibrated", () => {
    const paths = tempClaude();
    const snaps: UsageSnapshot[] = [];
    const lines: string[] = [];
    // Four busy intervals, each 100k weighted tokens per point
    for (let i = 0; i <= 4; i++) snaps.push({ at: T0 + i * H, fiveHour: i * 5, fiveHourResetsAt: "r" });
    for (let i = 0; i < 4; i++) lines.push(...assistantLines({ ts: T0 + i * H + H / 2, sessionId: "s1", input: 500_000 }));
    for (const s of snaps) recordSnapshot(s, paths);
    writeTranscript(paths, "-w", "s1", lines);
    expect(calibrate({ paths, now: T0 + 5 * H }).tokensPerPct.five_hour).toBeCloseTo(100_000);
    const text = formatUsageReport(usageReport({ paths, hours: 24, now: T0 + 5 * H }));
    expect(text).toMatch(/5h plan/);
    expect(text).toMatch(/20\.0%/);
  });
});
