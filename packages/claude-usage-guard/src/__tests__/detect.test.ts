import { describe, expect, it } from "vitest";
import { maskEmail, readAccount, readPlanUtilization } from "../account.js";
import { analyseIntervals, buildIntervals, detectForeignUsage, type UsageInterval } from "../detect.js";
import { parseWho } from "../signals.js";
import { readSnapshots, recordSnapshot, type UsageSnapshot } from "../snapshots.js";
import { assistantLines, planCache, tempClaude, writeClaudeJson, writeTranscript } from "./fixtures.js";

const H = 3_600_000;
const T0 = Date.parse("2026-11-18T10:00:00Z");

function interval(deltaPct: number, localWeighted: number): UsageInterval {
  return { from: 0, to: 1, window: "five_hour", deltaPct, localWeighted, unexplainedPct: 0, flagged: false };
}

describe("account and plan readers", () => {
  it("reads the signed-in account and the cached plan meters", () => {
    const paths = tempClaude();
    writeClaudeJson(paths, { oauthAccount: { accountUuid: "acct-1", emailAddress: "a@b.c", userRateLimitTier: "max" }, cachedUsageUtilization: planCache(T0, 25, 40) });
    expect(readAccount(paths)).toMatchObject({ accountUuid: "acct-1", email: "a***@b.c", rateLimitTier: "max" });
    expect(readPlanUtilization(paths)).toMatchObject({ fetchedAt: T0, fiveHour: { utilization: 25 }, sevenDay: { utilization: 40 } });
  });

  it("returns undefined for a missing or reshaped cache instead of throwing", () => {
    const paths = tempClaude();
    expect(readPlanUtilization(paths)).toBeUndefined();
    writeClaudeJson(paths, { cachedUsageUtilization: { fetchedAtMs: T0, utilization: { five_hour: { pct: 3 } } } });
    expect(readPlanUtilization(paths)).toBeUndefined();
  });
});

describe("maskEmail", () => {
  it("keeps two characters and the domain, also inside a personal organization name", () => {
    const paths = tempClaude();
    writeClaudeJson(paths, { oauthAccount: { emailAddress: "someone@example.com", organizationName: "someone@example.com's Organization" } });
    expect(readAccount(paths)).toMatchObject({ email: "so***@example.com", organizationName: "so***@example.com's Organization" });
    expect(maskEmail("nobody")).toBe("***");
  });
});

describe("snapshots", () => {
  it("stores each fetch once", () => {
    const paths = tempClaude();
    const snap: UsageSnapshot = { at: T0, fiveHour: 10 };
    expect(recordSnapshot(snap, paths)).toBe(true);
    expect(recordSnapshot(snap, paths)).toBe(false);
    expect(readSnapshots(paths)).toHaveLength(1);
  });
});

describe("interval analysis", () => {
  it("flags a meter rise while this machine was idle without needing calibration", () => {
    const { intervals } = analyseIntervals([interval(6, 0)]);
    expect(intervals[0].flagged).toBe(true);
  });

  it("treats one point of movement as rounding", () => {
    const { intervals } = analyseIntervals([interval(1, 0), interval(2, 0)]);
    expect(intervals.every((iv) => !iv.flagged)).toBe(true);
  });

  it("calibrates on busy intervals and flags one the machine cannot explain", () => {
    const calibration = [interval(5, 500_000), interval(4, 400_000), interval(10, 1_000_000), interval(3, 300_000)];
    const suspicious = interval(20, 300_000);
    const { intervals, tokensPerPct } = analyseIntervals([...calibration, suspicious]);
    expect(tokensPerPct.five_hour).toBeCloseTo(100_000, -3);
    expect(intervals.slice(0, 4).every((iv) => !iv.flagged)).toBe(true);
    expect(intervals[4].flagged).toBe(true);
    expect(intervals[4].unexplainedPct).toBeGreaterThan(14);
  });

  it("skips pairs that straddle a limit reset", () => {
    const snaps: UsageSnapshot[] = [
      { at: T0, fiveHour: 80, fiveHourResetsAt: "a" },
      { at: T0 + H, fiveHour: 5, fiveHourResetsAt: "b" },
    ];
    expect(buildIntervals(snaps, [])).toHaveLength(0);
  });
});

describe("detectForeignUsage", () => {
  function setup() {
    const paths = tempClaude();
    writeClaudeJson(paths, { oauthAccount: { accountUuid: "acct-1", emailAddress: "a@b.c" }, cachedUsageUtilization: planCache(T0 + 2 * H, 30, 40) });
    return paths;
  }

  it("reports likely other usage when the meter rose while this machine was idle", () => {
    const paths = setup();
    recordSnapshot({ at: T0, fiveHour: 10, fiveHourResetsAt: "2026-11-18T20:00:00Z" }, paths);
    const report = detectForeignUsage({ paths, now: T0 + 2 * H, liveSessions: [], remoteLogins: [] });
    expect(report.snapshotRecorded).toBe(true);
    expect(report.verdict).toBe("likely-other-usage");
    expect(report.intervals[0]).toMatchObject({ deltaPct: 20, flagged: true });
  });

  it("does not flag a rise this machine's own calls explain", () => {
    const paths = setup();
    recordSnapshot({ at: T0, fiveHour: 29, fiveHourResetsAt: "2026-11-18T20:00:00Z" }, paths);
    writeTranscript(paths, "-work-app", "s1", assistantLines({ ts: T0 + H, output: 50_000 }));
    const report = detectForeignUsage({ paths, now: T0 + 2 * H, liveSessions: [], remoteLogins: [] });
    expect(report.verdict).toBe("no-evidence");
  });

  it("flags a plan reading fetched for another account", () => {
    const paths = tempClaude();
    writeClaudeJson(paths, { oauthAccount: { accountUuid: "acct-1" }, cachedUsageUtilization: planCache(T0, 5, 5, "acct-2") });
    const report = detectForeignUsage({ paths, now: T0, liveSessions: [], remoteLogins: [] });
    expect(report.verdict).toBe("likely-other-usage");
    expect(report.signals[0].title).toMatch(/different account/);
  });

  it("flags SDK and script use of the login", () => {
    const paths = setup();
    writeTranscript(paths, "-work-app", "s1", [...assistantLines({ ts: T0, output: 1000, entrypoint: "cli" }), ...assistantLines({ ts: T0, output: 3000, entrypoint: "sdk-ts" })]);
    const report = detectForeignUsage({ paths, now: T0 + H, liveSessions: [], remoteLogins: [] });
    expect(report.signals.some((s) => s.title.includes("sdk-ts") && s.severity === "medium")).toBe(true);
    expect(report.verdict).toBe("suspicious");
  });

  it("flags remote logins", () => {
    const paths = setup();
    const report = detectForeignUsage({ paths, now: T0, liveSessions: [], remoteLogins: [{ user: "x", tty: "ttys9", host: "10.0.0.5", since: "Nov 18 10:00" }] });
    expect(report.verdict).toBe("suspicious");
  });

  it("says data is insufficient with a single reading", () => {
    const paths = setup();
    expect(detectForeignUsage({ paths, now: T0, liveSessions: [], remoteLogins: [] }).verdict).toBe("insufficient-data");
  });
});

describe("parseWho", () => {
  it("keeps remote hosts and drops local panes", () => {
    const out = ["me  console  Nov  1 14:47", "me  ttys000  Nov 17 19:02", "me  ttys003  Nov 18 09:00  (203.0.113.7)", "me  ttys004  Nov 18 09:00  (tmux(123).%0)", "me  pts/1  2026-11-18 09:00 (:0)"].join("\n");
    expect(parseWho(out)).toEqual([{ user: "me", tty: "ttys003", since: "Nov 18 09:00", host: "203.0.113.7" }]);
  });

  it("stays linear on pathological input", () => {
    const start = Date.now();
    parseWho(`! ! ${" ".repeat(200_000)}(${"( ((".repeat(20_000)}`);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
