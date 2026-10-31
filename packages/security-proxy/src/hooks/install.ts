import fs from "fs";
import os from "os";
import path from "path";
import type { AgentName } from "./agents.js";

/** Recognises the hook entries this package wrote, and nothing else. */
const OURS = /security-proxy[\\/]dist[\\/]hook-cli\.js|(?:^|[\s/\\"])guardbee-hook(?:\.cmd)?["\s]/;

const CURSOR_EVENTS = ["beforeShellExecution", "beforeMCPExecution", "beforeReadFile", "afterShellExecution", "afterMCPExecution"] as const;
const CLAUDE_EVENTS = ["PreToolUse", "PostToolUse"] as const;
const GEMINI_EVENTS = ["BeforeTool", "AfterTool"] as const;
const WINDSURF_EVENTS = ["pre_run_command", "pre_read_code", "pre_write_code", "pre_mcp_tool_use", "post_run_command", "post_mcp_tool_use"] as const;

/** Clients whose hooks are grouped under a matcher ({ matcher, hooks: [...] }); the others list commands per event. */
const GROUPED = new Set<AgentName>(["claude-code", "codex", "gemini-cli"]);

export interface InstallOptions {
  agent: AgentName;
  /** Project settings (.claude/settings.json, .cursor/hooks.json) instead of the user's. */
  project?: boolean;
  cwd?: string;
  home?: string;
  /** guardbee-proxy.yaml to evaluate against; absent → the hook's default lookup. */
  config?: string;
  /** On an internal error, block instead of letting the tool run. */
  failClosed?: boolean;
  /** The command that runs the hook; defaults to this Node and this package's hook-cli.js. */
  command?: string;
}

export function settingsPath(agent: AgentName, project = false, cwd = process.cwd(), home = os.homedir()): string {
  const base = project ? cwd : home;
  switch (agent) {
    case "claude-code":
      return path.join(base, ".claude", "settings.json");
    case "cursor":
      return path.join(base, ".cursor", "hooks.json");
    case "codex":
      return path.join(base, ".codex", "hooks.json");
    case "gemini-cli":
      return path.join(base, ".gemini", "settings.json");
    case "windsurf":
      return project ? path.join(cwd, ".windsurf", "hooks.json") : path.join(home, ".codeium", "windsurf", "hooks.json");
  }
}

const quote = (value: string) => `"${value.replace(/(["\\$`])/g, "\\$1")}"`;

export function hookCommand(options: InstallOptions, script: string): string {
  if (options.command) return options.command;
  const args = [options.agent, ...(options.config ? ["--config", path.resolve(options.config)] : []), ...(options.failClosed ? ["--fail-closed"] : [])];
  return [quote(process.execPath), quote(script), ...args.map((a) => (/^[\w./:-]+$/.test(a) ? a : quote(a)))].join(" ");
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const isOurs = (entry: unknown) => OURS.test(String(obj(entry)["command"] ?? ""));

/** Drop our entries from a settings object (the rest stays exactly as it was). */
function withoutOurs(agent: AgentName, settings: Json): Json {
  const hooks = { ...obj(settings["hooks"]) };
  for (const [event, value] of Object.entries(hooks)) {
    // Settings that live next to the events (Gemini CLI's hooks.enabled) stay
    if (!Array.isArray(value)) continue;
    if (GROUPED.has(agent)) {
      const groups = list(value)
        .map((group) => ({ ...obj(group), hooks: list(obj(group)["hooks"]).filter((h) => !isOurs(h)) }))
        .filter((group) => group.hooks.length > 0);
      if (groups.length > 0) hooks[event] = groups;
      else delete hooks[event];
    } else {
      const entries = list(value).filter((h) => !isOurs(h));
      if (entries.length > 0) hooks[event] = entries;
      else delete hooks[event];
    }
  }
  return { ...settings, hooks };
}

function read(file: string): Json {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  try {
    return obj(JSON.parse(text));
  } catch {
    throw new Error(`${file} is not valid JSON; fix it first, nothing was changed`);
  }
}

function write(file: string, settings: Json): string | null {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    backup = `${file}.guardbee-backup`;
    fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  return backup;
}

export interface InstallResult {
  file: string;
  backup: string | null;
  command: string;
  settings: Json;
}

/** Add (or replace) our hook entries; other hooks and settings are kept. */
export function planInstall(options: InstallOptions, script: string): InstallResult {
  const file = settingsPath(options.agent, options.project, options.cwd, options.home);
  const command = hookCommand(options, script);
  const settings = withoutOurs(options.agent, read(file));
  const hooks = obj(settings["hooks"]);
  switch (options.agent) {
    case "claude-code":
      for (const event of CLAUDE_EVENTS) hooks[event] = [...list(hooks[event]), { matcher: "*", hooks: [{ type: "command", command, timeout: 30 }] }];
      break;
    case "codex":
      for (const event of CLAUDE_EVENTS) hooks[event] = [...list(hooks[event]), { matcher: ".*", hooks: [{ type: "command", command, timeout: 30 }] }];
      break;
    case "gemini-cli":
      for (const event of GEMINI_EVENTS) hooks[event] = [...list(hooks[event]), { matcher: ".*", hooks: [{ type: "command", command, name: "guardbee", timeout: 30_000 }] }];
      // Gemini CLI runs hooks only when both switches are on
      hooks["enabled"] = true;
      settings["tools"] = { ...obj(settings["tools"]), enableHooks: true };
      break;
    case "windsurf":
      for (const event of WINDSURF_EVENTS) hooks[event] = [...list(hooks[event]), { command, show_output: false }];
      break;
    case "cursor":
      settings["version"] ??= 1;
      for (const event of CURSOR_EVENTS) hooks[event] = [...list(hooks[event]), { command }];
      break;
  }
  return { file, backup: null, command, settings: { ...settings, hooks } };
}

export function install(options: InstallOptions, script: string): InstallResult {
  const plan = planInstall(options, script);
  return { ...plan, backup: write(plan.file, plan.settings) };
}

export function uninstall(options: Pick<InstallOptions, "agent" | "project" | "cwd" | "home">): { file: string; removed: boolean; backup: string | null } {
  const file = settingsPath(options.agent, options.project, options.cwd, options.home);
  const before = read(file);
  const after = withoutOurs(options.agent, before);
  if (Object.keys(obj(after["hooks"])).length === 0) delete after["hooks"];
  const removed = JSON.stringify(before) !== JSON.stringify(after);
  return { file, removed, backup: removed ? write(file, after) : null };
}
