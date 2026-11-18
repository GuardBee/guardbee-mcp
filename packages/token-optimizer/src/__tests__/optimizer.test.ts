import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ClaudePaths } from "@guardbee/mcp-claude-usage-guard";
import { auditMcpServers, disableMcpServers, listParked, restoreMcpServers } from "../mcp.js";
import { optimizationReport } from "../optimize.js";
import { ancestorPids, isClaudeCommand, listSessions, parseElapsed, parsePs, stopSessions, type SessionInfo } from "../sessions.js";

const T0 = Date.parse("2026-11-18T10:00:00Z");
const H = 3_600_000;

function tempClaude(): ClaudePaths & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "guardbee-opt-"));
  const paths = { root, claudeDir: join(root, ".claude"), claudeJson: join(root, ".claude.json"), stateDir: join(root, ".guardbee", "claude-usage-guard") };
  mkdirSync(join(paths.claudeDir, "projects"), { recursive: true });
  return paths;
}

function line(obj: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date(T0).toISOString(), sessionId: "s1", cwd: "/work", ...obj });
}

function call(id: string, sessionId: string, usage: Record<string, number>, ts = T0): string {
  return JSON.stringify({ type: "assistant", timestamp: new Date(ts).toISOString(), sessionId, cwd: "/work", requestId: id, message: { id, model: "claude-opus-5-5", content: [], usage } });
}

function transcript(paths: ClaudePaths, sessionId: string, lines: string[]): void {
  const dir = join(paths.claudeDir, "projects", "-work");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join("\n"));
}

function session(partial: Partial<SessionInfo> & { pid: number }): SessionInfo {
  return { tty: "ttys001", elapsedSeconds: 3600, cpu: 0.1, currentContext: 0, recentWeighted: 0, isSelf: false, status: "idle", ...partial };
}

describe("process parsing", () => {
  it("parses ps elapsed times", () => {
    expect(parseElapsed("05:07")).toBe(307);
    expect(parseElapsed("02:00:01")).toBe(7201);
    expect(parseElapsed("17-02:45:28")).toBe(17 * 86400 + 2 * 3600 + 45 * 60 + 28);
  });

  it("recognises the CLI but not the desktop app", () => {
    expect(isClaudeCommand("claude")).toBe(true);
    expect(isClaudeCommand("/Users/me/.vscode/extensions/anthropic.claude-code-2/resources/native-binary/claude --output-format stream-json")).toBe(true);
    expect(isClaudeCommand("node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js")).toBe(true);
    expect(isClaudeCommand("/Applications/Claude.app/Contents/MacOS/Claude")).toBe(false);
    expect(isClaudeCommand("vim claude-notes.md")).toBe(false);
  });

  it("parses ps rows with spaces in the command, and stays linear on pathological input", () => {
    expect(parsePs("  42   1   01:02  3.5 ttys001 node /a b/cli.js --x")).toEqual([
      { pid: 42, ppid: 1, elapsed: "01:02", elapsedSeconds: 62, cpu: 3.5, tty: "ttys001", command: "node /a b/cli.js --x" },
    ]);
    const start = Date.now();
    expect(parsePs(`0 0 ! . ! ${" ".repeat(200_000)}x`)).toEqual([]);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("walks the parent chain", () => {
    const ps = parsePs(["  1     0  9-00:00:00  0.0 ??  launchd", " 50     1  01:00  0.0 ttys1 claude", " 60    50  00:10  0.0 ttys1 node server.js"].join("\n"));
    expect([...ancestorPids(ps, 60)]).toEqual([60, 50]);
  });
});

describe("listSessions", () => {
  it("joins processes with the session registry and transcript context", () => {
    const paths = tempClaude();
    mkdirSync(join(paths.claudeDir, "sessions"));
    writeFileSync(join(paths.claudeDir, "sessions", "50.json"), JSON.stringify({ pid: 50, sessionId: "s1", cwd: "/work", status: "idle", startedAt: T0 - H }));
    transcript(paths, "s1", [call("a", "s1", { cache_read_input_tokens: 100_000, input_tokens: 5 }, T0), call("b", "s1", { cache_read_input_tokens: 300_000, output_tokens: 10 }, T0 + 1000)]);
    const processes = parsePs([" 50  1  01:00:00  0.2 ttys001 claude", " 70  1  01:00  0.0 ttys002 bash"].join("\n"));
    const [s] = listSessions({ paths, processes, now: T0 + H, selfPid: 999 });
    expect(s).toMatchObject({ pid: 50, sessionId: "s1", currentContext: 300_000, isSelf: false });
    expect(s.recentWeighted).toBeGreaterThan(0);
  });
});

describe("stopSessions", () => {
  const sessions = [session({ pid: 10 }), session({ pid: 11, isSelf: true }), session({ pid: 12, status: "busy", cpu: 40 })];

  it("is a dry run by default", () => {
    const kill = vi.fn();
    expect(stopSessions({ pids: [10], sessions, kill })).toEqual([{ pid: 10, action: "would-stop" }]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("never stops its own session or a non-Claude pid", () => {
    const kill = vi.fn();
    const results = stopSessions({ pids: [11, 4242], sessions, kill, dryRun: false });
    expect(results.map((r) => r.action)).toEqual(["skipped", "skipped"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("stops idle sessions past the threshold but not busy ones", () => {
    const kill = vi.fn();
    const withActivity = sessions.map((s) => ({ ...s, lastActivity: T0 - 10 * H }));
    const results = stopSessions({ idleHours: 6, sessions: withActivity, kill, dryRun: false, now: T0 });
    expect(results).toEqual([{ pid: 10, action: "stopped" }, { pid: 11, action: "skipped", reason: "this is the session running the optimizer" }]);
    expect(kill).toHaveBeenCalledWith(10);
  });
});

describe("MCP servers", () => {
  function setup() {
    const paths = tempClaude();
    const project = join(paths.root, "proj");
    mkdirSync(project);
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db-mcp" } } }));
    const pluginDir = join(paths.root, "plugin-install");
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, ".mcp.json"), "{}");
    mkdirSync(join(paths.claudeDir, "plugins"), { recursive: true });
    writeFileSync(
      join(paths.claudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "gh@market": [{ installPath: pluginDir }], "lsp@market": [{ installPath: join(paths.root, "none") }] } })
    );
    writeFileSync(join(paths.claudeDir, "settings.json"), JSON.stringify({ theme: "dark", enabledPlugins: { "gh@market": true, "lsp@market": true } }));
    writeFileSync(
      paths.claudeJson,
      JSON.stringify({ numStartups: 3, mcpServers: { github: { command: "gh-mcp" }, unused: { command: "x" } }, projects: { [project]: { mcpServers: { local1: { command: "l" } }, disabledMcpjsonServers: [] } } })
    );
    transcript(paths, "s1", [
      line({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "mcp__github__search", input: {} }] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "r".repeat(1000) }] } }),
      line({ type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "t2", name: "mcp__claude_ai_Gmail__list", input: {} }] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "g" }] } }),
    ]);
    return { paths, project };
  }

  it("lists every scope with usage, and only plugins that ship an MCP server", () => {
    const { paths, project } = setup();
    const servers = auditMcpServers({ paths, now: T0 + H });
    const byName = Object.fromEntries(servers.map((s) => [s.name, s]));
    expect(byName.github).toMatchObject({ scope: "user", calls: 1, resultChars: 1000 });
    expect(byName.unused).toMatchObject({ scope: "user", calls: 0 });
    expect(byName.local1).toMatchObject({ scope: "local", project });
    expect(byName.db).toMatchObject({ scope: "project", project });
    expect(byName["gh@market"]).toMatchObject({ scope: "plugin" });
    expect(byName["lsp@market"]).toBeUndefined();
    expect(byName.claude_ai_Gmail).toMatchObject({ scope: "external", toggleable: false });
  });

  it("dry run leaves the config untouched", () => {
    const { paths } = setup();
    const before = readFileSync(paths.claudeJson, "utf8");
    const [r] = disableMcpServers([{ name: "unused", scope: "user" }], { paths });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^would /);
    expect(readFileSync(paths.claudeJson, "utf8")).toBe(before);
  });

  it("parks and restores user servers, keeping the rest of the config and a backup", () => {
    const { paths } = setup();
    const [r] = disableMcpServers([{ name: "unused", scope: "user" }], { paths, dryRun: false });
    expect(r.ok).toBe(true);
    expect(r.backup && existsSync(r.backup)).toBe(true);
    let config = JSON.parse(readFileSync(paths.claudeJson, "utf8"));
    expect(config.mcpServers.unused).toBeUndefined();
    expect(config.numStartups).toBe(3);
    expect(listParked(paths)).toHaveLength(1);

    restoreMcpServers([{ name: "unused", scope: "user" }], { paths, dryRun: false });
    config = JSON.parse(readFileSync(paths.claudeJson, "utf8"));
    expect(config.mcpServers.unused).toEqual({ command: "x" });
    expect(listParked(paths)).toHaveLength(0);
  });

  it("uses Claude Code's own switches for .mcp.json servers and plugins", () => {
    const { paths, project } = setup();
    disableMcpServers([{ name: "db", scope: "project", project }, { name: "gh@market", scope: "plugin" }], { paths, dryRun: false });
    expect(JSON.parse(readFileSync(paths.claudeJson, "utf8")).projects[project].disabledMcpjsonServers).toEqual(["db"]);
    const settings = JSON.parse(readFileSync(join(paths.claudeDir, "settings.json"), "utf8"));
    expect(settings.enabledPlugins["gh@market"]).toBe(false);
    expect(settings.theme).toBe("dark");
    expect(readdirSync(join(paths.root, ".guardbee", "token-optimizer", "backups"))).toHaveLength(2);
  });

  it("refuses what it cannot toggle or restore", () => {
    const { paths } = setup();
    const results = disableMcpServers(
      [{ name: "claude_ai_Gmail", scope: "external" }, { name: "nope", scope: "user" }, { name: "db", scope: "project" }],
      { paths, dryRun: false }
    );
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(restoreMcpServers([{ name: "github", scope: "user" }], { paths })[0].ok).toBe(false);
  });
});

describe("optimizationReport", () => {
  it("recommends compacting big live sessions, and flags bloated past sessions and heavy reads", () => {
    const paths = tempClaude();
    writeFileSync(paths.claudeJson, "{}");
    transcript(paths, "old", [
      call("x1", "old", { cache_read_input_tokens: 500_000, output_tokens: 100 }),
      line({ sessionId: "old", type: "assistant", message: { id: "x2", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/big.log" } }] } }),
      line({ sessionId: "old", type: "user", message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "z".repeat(600_000) }] } }),
    ]);
    const recs = optimizationReport({ paths, now: T0 + H, sessions: [session({ pid: 5, sessionId: "live", currentContext: 400_000 })], mcpServers: [] });
    const titles = recs.map((r) => r.title).join("\n");
    expect(titles).toMatch(/pid 5 re-reads 400k/);
    expect(titles).toMatch(/past session\(s\) ran with contexts up to 500k/);
    expect(titles).toMatch(/Read of \/big\.log/);
    expect(recs[0].impact).toBe("high");
  });

  it("has nothing to say about a lean setup", () => {
    const paths = tempClaude();
    writeFileSync(paths.claudeJson, "{}");
    expect(optimizationReport({ paths, now: T0, sessions: [], mcpServers: [] })).toEqual([]);
  });
});
