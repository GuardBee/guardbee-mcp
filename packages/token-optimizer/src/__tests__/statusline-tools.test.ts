import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readSnapshots, recordSnapshot, type ClaudePaths } from "@guardbee/mcp-claude-usage-guard";
import { installContextHooks } from "../context-hook.js";
import { installStatusLineCommand, statusLine } from "../statusline.js";
import { outputChars, toolOutputHook } from "../tool-output.js";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const RESET_S = Date.parse("2026-11-20T14:30:00Z") / 1000;

function tempClaude(): ClaudePaths & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "guardbee-sl-"));
  const paths = { root, claudeDir: join(root, ".claude"), claudeJson: join(root, ".claude.json"), stateDir: join(root, ".guardbee", "claude-usage-guard") };
  mkdirSync(paths.claudeDir, { recursive: true });
  writeFileSync(paths.claudeJson, "{}");
  return paths;
}

function input(paths: { root: string }, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const transcript = join(paths.root, "t.jsonl");
  writeFileSync(transcript, "{}\n");
  utimesSync(transcript, new Date(NOW), new Date(NOW));
  return {
    transcript_path: transcript,
    model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
    context_window: { context_window_size: 1_000_000, current_usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 313_990 } },
    rate_limits: { five_hour: { used_percentage: 42.4, resets_at: RESET_S }, seven_day: { used_percentage: 18, resets_at: RESET_S + 3 * 86_400 } },
    ...extra,
  };
}

describe("statusLine", () => {
  it("shows context, plan meters and time to reset, and records the reading", () => {
    const paths = tempClaude();
    const line = statusLine(input(paths), { paths, now: NOW, color: false });
    expect(line).toBe("Opus 5.5 · ctx 314k/1M · 5h 42% ↻2h30m · 7d 18%");
    expect(readSnapshots(paths)).toHaveLength(1);
  });

  it("adds the plan cost per message, the limit warning and the alarm, in Turkish", () => {
    const paths = tempClaude();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(join(paths.stateDir, "alarm.json"), JSON.stringify({ tokensPerPct: { five_hour: 10_000 }, lastAlert: { at: NOW - 3_600_000, message: "x" } }));
    // 20 points in the last 40 minutes: 30 pt/hour, so 100% well before the reset
    recordSnapshot({ at: NOW - 40 * 60_000, fiveHour: 22.4, fiveHourResetsAt: new Date(RESET_S * 1000).toISOString() }, paths);
    const line = statusLine(input(paths), { paths, now: NOW, color: false, lang: "tr" });
    expect(line).toMatch(/ctx 314k\/1M \(~%3\.1\/mesaj\)/);
    expect(line).toMatch(/5h 42% ↻2h30m → %100 \d\d:\d\d/);
    expect(line).toMatch(/🚨 dış kullanım/);
  });

  it("falls back to the transcript and the cached reading, and drops a reading from before a reset", () => {
    const paths = tempClaude();
    writeFileSync(
      paths.claudeJson,
      JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: NOW - 3_600_000, utilization: { five_hour: { utilization: 70, resets_at: "2026-11-20T11:00:00Z" }, seven_day: { utilization: 30, resets_at: "2026-11-23T00:00:00Z" } } } })
    );
    const transcript = join(paths.root, "t.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 5, cache_read_input_tokens: 250_000 } } }) + "\n");
    const line = statusLine({ transcript_path: transcript }, { paths, now: NOW, color: false });
    expect(line).toBe("ctx 250k · 7d 30%");
  });

  it("colours the context by threshold", () => {
    const paths = tempClaude();
    expect(statusLine(input(paths), { paths, now: NOW, threshold: 200_000 })).toContain("\x1b[33mctx 314k");
  });

  it("installs as Claude Code's status line", () => {
    const paths = tempClaude();
    const result = installStatusLineCommand({ paths, apply: true, scriptPath: "/opt/o/cli.js", version: "1.0.0", lang: "tr" });
    expect(result.applied).toBe(true);
    expect(JSON.parse(readFileSync(join(paths.claudeDir, "settings.json"), "utf8")).statusLine.command).toBe('node "/opt/o/cli.js" statusline --lang tr # guardbee:token-optimizer:statusline');
  });
});

describe("tool output warning", () => {
  const big = { type: "text", file: { filePath: "/a/big.ts", content: "x".repeat(80_000), numLines: 2000 } };

  it("sizes results, counting images flat and skipping usage metadata", () => {
    expect(outputChars({ stdout: "abc", stderr: "" })).toBe(3);
    expect(outputChars([{ type: "image", source: { data: "A".repeat(500_000) } }])).toBe(6400);
    expect(outputChars({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 123456 }, totalTokens: 999 })).toBe(6);
  });

  it("warns once per cooldown for a big result, with advice for the tool", () => {
    const paths = tempClaude();
    const event = { session_id: "s1", tool_name: "Read", tool_input: { file_path: "/a/big.ts" }, tool_response: big };
    const out = toolOutputHook(event, { paths, now: NOW, lang: "tr" });
    expect(out?.systemMessage).toMatch(/Read \(\/a\/big\.ts\) bağlama ~20k token ekledi/);
    expect(out?.systemMessage).toMatch(/offset\/limit/);
    expect(toolOutputHook(event, { paths, now: NOW + 60_000 })).toBeUndefined();
    expect(toolOutputHook({ ...event, session_id: "s2" }, { paths, now: NOW + 60_000 })?.systemMessage).toMatch(/added ~20k tokens/);
    expect(toolOutputHook(event, { paths, now: NOW + 4 * 60_000 })).toBeDefined();
  });

  it("ignores small results", () => {
    const paths = tempClaude();
    expect(toolOutputHook({ session_id: "s", tool_name: "mcp__db__query", tool_response: { rows: "x".repeat(1000) } }, { paths, now: NOW })).toBeUndefined();
    expect(toolOutputHook({ session_id: "s", tool_name: "mcp__db__query", tool_response: { rows: "x".repeat(1000) } }, { paths, now: NOW, threshold: 100 })?.systemMessage).toMatch(/mcp__db__query added/);
  });

  it("is installed as a PostToolUse hook next to the context warning", () => {
    const paths = tempClaude();
    const result = installContextHooks({ paths, scriptPath: "/opt/o/cli.js", version: "1.0.0", toolThreshold: 5000 });
    expect(result.changes.map((c) => c.event)).toEqual(["UserPromptSubmit", "SessionStart [resume]", expect.stringMatching(/^PostToolUse \[/)]);
    expect(result.changes[2].command).toContain("hook --tool-threshold 5000");
  });
});
