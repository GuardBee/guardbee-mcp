import { describe, expect, it } from "vitest";
import { scanTranscripts, summarize, weightedTokens, contextSize, mcpServerOf } from "../transcripts.js";
import { assistantLines, tempClaude, writeTranscript } from "./fixtures.js";

const T0 = Date.parse("2026-11-18T10:00:00Z");

describe("scanTranscripts", () => {
  it("counts a response once even though each content block repeats its usage", () => {
    const paths = tempClaude();
    writeTranscript(paths, "-work-app", "s1", [
      ...assistantLines({ ts: T0, output: 100, cacheRead: 1000, blocks: 3 }),
      ...assistantLines({ ts: T0 + 1000, output: 50, blocks: 2 }),
    ]);
    const { usage } = scanTranscripts({ paths });
    expect(usage).toHaveLength(2);
    expect(usage.reduce((s, r) => s + r.output, 0)).toBe(150);
  });

  it("keeps only calls inside the window", () => {
    const paths = tempClaude();
    writeTranscript(paths, "-work-app", "s1", [...assistantLines({ ts: T0, output: 1 }), ...assistantLines({ ts: T0 + 3_600_000, output: 2 })]);
    const { usage } = scanTranscripts({ paths, sinceMs: T0 + 1, untilMs: T0 + 3_600_000 });
    expect(usage.map((r) => r.output)).toEqual([2]);
  });

  it("reads subagent transcripts in nested directories", () => {
    const paths = tempClaude();
    writeTranscript(paths, "-work-app/s1/subagents", "agent-1", assistantLines({ ts: T0, output: 7, isSidechain: true }));
    const { usage } = scanTranscripts({ paths });
    expect(usage[0]).toMatchObject({ isSidechain: true, output: 7 });
  });

  it("pairs tool calls with their results and sizes images by tokens, not base64 length", () => {
    const paths = tempClaude();
    const ts = new Date(T0).toISOString();
    writeTranscript(paths, "-work-app", "s1", [
      JSON.stringify({ type: "assistant", timestamp: ts, sessionId: "s1", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } }] } }),
      JSON.stringify({ type: "user", timestamp: ts, sessionId: "s1", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(400) }] } }),
      JSON.stringify({ type: "assistant", timestamp: ts, sessionId: "s1", message: { id: "m2", content: [{ type: "tool_use", id: "t2", name: "mcp__github__search", input: {} }] } }),
      JSON.stringify({ type: "user", timestamp: ts, sessionId: "s1", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "image", source: { data: "A".repeat(500_000) } }] }] } }),
    ]);
    const { toolCalls } = scanTranscripts({ paths, includeToolCalls: true });
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toMatchObject({ tool: "Read", target: "/a.ts", resultChars: 400 });
    expect(toolCalls[1].server).toBe("github");
    expect(toolCalls[1].resultChars).toBeLessThan(10_000);
  });

  it("skips malformed lines", () => {
    const paths = tempClaude();
    writeTranscript(paths, "-work-app", "s1", ["{not json", ...assistantLines({ ts: T0, output: 3 })]);
    expect(scanTranscripts({ paths }).usage).toHaveLength(1);
  });
});

describe("weighting", () => {
  it("weights output and cache traffic by price, and cheaper models less", () => {
    const base = { input: 100, output: 10, cacheRead: 1000, cacheWrite: 80 };
    expect(weightedTokens({ ...base, model: "claude-opus-5-5" })).toBe(100 + 100 + 100 + 50);
    expect(weightedTokens({ ...base, model: "claude-haiku-4-5" })).toBeCloseTo(350 * 0.2);
    expect(contextSize(base)).toBe(1180);
  });

  it("summarizes per session with peak context", () => {
    const paths = tempClaude();
    writeTranscript(paths, "-work-app", "s1", [...assistantLines({ ts: T0, sessionId: "a", cacheRead: 500 }), ...assistantLines({ ts: T0, sessionId: "a", cacheRead: 900 }), ...assistantLines({ ts: T0, sessionId: "b", output: 1 })]);
    const groups = summarize(scanTranscripts({ paths }).usage, "session");
    const a = groups.find((g) => g.key === "a")!;
    expect(a.calls).toBe(2);
    expect(a.peakContext).toBe(900);
  });

  it("extracts the MCP server from a tool name", () => {
    expect(mcpServerOf("mcp__claude_ai_Gmail__send")).toBe("claude_ai_Gmail");
    expect(mcpServerOf("Read")).toBeUndefined();
  });
});
