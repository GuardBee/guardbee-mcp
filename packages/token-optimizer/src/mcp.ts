import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { backupFile, resolvePaths, scanTranscripts, writeJsonAtomic, type ClaudePaths } from "@guardbee/mcp-claude-usage-guard";

export type McpScope = "user" | "local" | "project" | "plugin" | "external";

export interface McpServerEntry {
  name: string;
  scope: McpScope;
  /** Project directory for local/project scope */
  project?: string;
  /** Already disabled in Claude Code's config */
  disabled: boolean;
  /** Can this tool turn it off locally? claude.ai connectors and built-in integrations are not in the local config */
  toggleable: boolean;
  calls: number;
  /** Characters its tool results put into context in the window */
  resultChars: number;
  lastUsed?: number;
}

export interface McpAuditOptions {
  paths?: Partial<ClaudePaths>;
  /** Project whose local and .mcp.json servers to include (default: every project Claude Code knows) */
  project?: string;
  hours?: number;
  now?: number;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const keysOf = (v: unknown) => (v && typeof v === "object" ? Object.keys(v as object) : []);
const listOf = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

/** Where an installed plugin's files live, from Claude Code's installed_plugins.json. */
export function pluginInstallPaths(paths: ClaudePaths, id: string): string[] {
  const installed = readJson(join(paths.claudeDir, "plugins", "installed_plugins.json"));
  const installs = ((installed?.plugins ?? {}) as Record<string, Array<{ installPath?: string }>>)[id] ?? [];
  return installs.map((i) => i.installPath).filter((p): p is string => !!p);
}

/** Plugins can bring hooks, skills or LSP servers instead; only those shipping an MCP server count here. */
export function pluginHasMcp(paths: ClaudePaths, id: string): boolean {
  return pluginInstallPaths(paths, id).some((root) => existsSync(join(root, ".mcp.json")) || !!readJson(join(root, ".claude-plugin", "plugin.json"))?.mcpServers);
}

/** Tool names carry a sanitised server name (mcp__<name>__tool), so names are compared that way. */
export function toolPrefixName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Every MCP server Claude Code would start, by scope, with how much its tools were used. Tool
 * results land in the context and are re-read on every later turn, so a chatty server costs far
 * more than its call count suggests; an unused one still costs its startup and tool listing.
 */
export function auditMcpServers(options: McpAuditOptions = {}): McpServerEntry[] {
  const paths = resolvePaths(options.paths);
  const now = options.now ?? Date.now();
  const config = readJson(paths.claudeJson) ?? {};
  const settings = readJson(join(paths.claudeDir, "settings.json")) ?? {};
  const projects = (config.projects ?? {}) as Record<string, Record<string, unknown>>;
  const entries: McpServerEntry[] = [];
  const add = (name: string, scope: McpScope, project?: string, disabled = false, toggleable = true) =>
    entries.push({ name, scope, project, disabled, toggleable, calls: 0, resultChars: 0 });

  for (const name of keysOf(config.mcpServers)) add(name, "user");
  const projectDirs = options.project ? [options.project] : Object.keys(projects);
  for (const dir of projectDirs) {
    const p = projects[dir] ?? {};
    const disabledLocal = new Set(listOf(p.disabledMcpServers));
    for (const name of keysOf(p.mcpServers)) add(name, "local", dir, disabledLocal.has(name));
    const mcpJson = readJson(join(dir, ".mcp.json"));
    const disabledProject = new Set(listOf(p.disabledMcpjsonServers));
    for (const name of keysOf(mcpJson?.mcpServers)) add(name, "project", dir, disabledProject.has(name));
  }
  const plugins = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
  for (const [id, enabled] of Object.entries(plugins)) {
    if (pluginHasMcp(paths, id)) add(id, "plugin", undefined, enabled === false);
  }

  const { toolCalls } = scanTranscripts({ paths, sinceMs: now - (options.hours ?? 24 * 7) * 3_600_000, untilMs: now, includeToolCalls: true });
  const usage = new Map<string, { calls: number; chars: number; last: number }>();
  for (const call of toolCalls) {
    if (!call.server) continue;
    const u = usage.get(call.server) ?? { calls: 0, chars: 0, last: 0 };
    u.calls++;
    u.chars += call.resultChars;
    u.last = Math.max(u.last, call.ts);
    usage.set(call.server, u);
  }
  const matched = new Set<string>();
  for (const e of entries) {
    // A plugin's servers are named plugin_<plugin>_<server>; match on the plugin name
    const keys =
      e.scope === "plugin"
        ? [...usage.keys()].filter((k) => k.startsWith(`plugin_${toolPrefixName(e.name.split("@")[0])}`))
        : [toolPrefixName(e.name)].filter((k) => usage.has(k));
    for (const k of keys) {
      const u = usage.get(k)!;
      e.calls += u.calls;
      e.resultChars += u.chars;
      e.lastUsed = Math.max(e.lastUsed ?? 0, u.last);
      matched.add(k);
    }
  }
  // Servers seen in transcripts but configured nowhere locally: claude.ai connectors and built-ins
  for (const [k, u] of usage) {
    if (matched.has(k)) continue;
    entries.push({ name: k, scope: "external", disabled: false, toggleable: false, calls: u.calls, resultChars: u.chars, lastUsed: u.last });
  }
  return entries.sort((a, b) => b.resultChars - a.resultChars || b.calls - a.calls);
}

interface ParkedServer {
  name: string;
  scope: "user" | "local";
  project?: string;
  config: unknown;
  parkedAt: number;
}

/** Sits beside the usage guard's state: ~/.guardbee/token-optimizer */
function optimizerDir(paths: ClaudePaths): string {
  return join(paths.stateDir, "..", "token-optimizer");
}

function parkedFile(paths: ClaudePaths): string {
  return join(optimizerDir(paths), "parked.json");
}

function readParked(paths: ClaudePaths): ParkedServer[] {
  try {
    return JSON.parse(readFileSync(parkedFile(paths), "utf8")) as ParkedServer[];
  } catch {
    return [];
  }
}


function backup(paths: ClaudePaths, file: string): string {
  return backupFile(file, join(optimizerDir(paths), "backups"));
}

export interface ToggleRequest {
  name: string;
  scope: McpScope;
  project?: string;
}

export interface ToggleResult {
  name: string;
  scope: McpScope;
  ok: boolean;
  message: string;
  backup?: string;
}

/**
 * Turns MCP servers off without losing them. Project (.mcp.json) servers and plugins have their
 * own disable switch in Claude Code's config; user and local servers do not, so their entry is
 * moved to a parked list that `restore` puts back. Takes effect in sessions started afterwards.
 */
export function disableMcpServers(requests: ToggleRequest[], options: { paths?: Partial<ClaudePaths>; dryRun?: boolean } = {}): ToggleResult[] {
  return toggle(requests, "disable", options);
}

export function restoreMcpServers(requests: ToggleRequest[], options: { paths?: Partial<ClaudePaths>; dryRun?: boolean } = {}): ToggleResult[] {
  return toggle(requests, "restore", options);
}

export function listParked(paths?: Partial<ClaudePaths>): ParkedServer[] {
  return readParked(resolvePaths(paths));
}

function toggle(requests: ToggleRequest[], mode: "disable" | "restore", options: { paths?: Partial<ClaudePaths>; dryRun?: boolean }): ToggleResult[] {
  const paths = resolvePaths(options.paths);
  const dryRun = options.dryRun !== false;
  const results: ToggleResult[] = [];
  const config = readJson(paths.claudeJson);
  const settingsPath = join(paths.claudeDir, "settings.json");
  const settings = readJson(settingsPath);
  let parked = readParked(paths);
  let configDirty = false;
  let settingsDirty = false;
  let parkedDirty = false;

  for (const req of requests) {
    const fail = (message: string) => results.push({ name: req.name, scope: req.scope, ok: false, message });
    const done = (message: string) => results.push({ name: req.name, scope: req.scope, ok: true, message: dryRun ? `would ${message}` : message });

    if (req.scope === "external") {
      fail("not in Claude Code's local config: a claude.ai connector (turn off on claude.ai under Settings → Connectors) or a built-in integration (turn off in its own settings)");
      continue;
    }
    if (req.scope === "plugin") {
      if (!settings) {
        fail(`cannot read ${settingsPath}`);
        continue;
      }
      const plugins = (settings.enabledPlugins ??= {}) as Record<string, boolean>;
      if (!(req.name in plugins)) {
        fail("plugin not found in settings.json enabledPlugins");
        continue;
      }
      plugins[req.name] = mode === "restore";
      settingsDirty = true;
      done(`${mode === "disable" ? "disable" : "enable"} plugin ${req.name}`);
      continue;
    }
    if (!config) {
      fail(`cannot read ${paths.claudeJson}`);
      continue;
    }
    if ((req.scope === "local" || req.scope === "project") && !req.project) {
      fail(`${req.scope} scope needs the project directory`);
      continue;
    }
    const projects = (config.projects ??= {}) as Record<string, Record<string, unknown>>;

    if (req.scope === "project") {
      const p = (projects[req.project!] ??= {});
      const disabled = new Set(listOf(p.disabledMcpjsonServers));
      const enabled = new Set(listOf(p.enabledMcpjsonServers));
      if (mode === "disable") {
        disabled.add(req.name);
        enabled.delete(req.name);
      } else disabled.delete(req.name);
      p.disabledMcpjsonServers = [...disabled];
      p.enabledMcpjsonServers = [...enabled];
      configDirty = true;
      done(`${mode} .mcp.json server ${req.name} in ${req.project}`);
      continue;
    }

    // user / local: park or unpark the server definition
    const holder = req.scope === "user" ? config : (projects[req.project!] ??= {});
    const servers = (holder.mcpServers ??= {}) as Record<string, unknown>;
    if (mode === "disable") {
      if (!(req.name in servers)) {
        fail(`no ${req.scope} MCP server named ${req.name}`);
        continue;
      }
      parked = parked.filter((x) => !(x.name === req.name && x.scope === req.scope && x.project === req.project));
      parked.push({ name: req.name, scope: req.scope as "user" | "local", project: req.project, config: servers[req.name], parkedAt: Date.now() });
      delete servers[req.name];
      done(`park ${req.scope} server ${req.name} (restore brings it back)`);
    } else {
      const entry = parked.find((x) => x.name === req.name && x.scope === req.scope && x.project === req.project);
      if (!entry) {
        fail("not parked by the optimizer");
        continue;
      }
      if (req.name in servers) {
        fail("a server with this name has been configured again since; not overwriting it");
        continue;
      }
      servers[req.name] = entry.config;
      parked = parked.filter((x) => x !== entry);
      done(`restore ${req.scope} server ${req.name}`);
    }
    configDirty = true;
    parkedDirty = true;
  }

  if (!dryRun) {
    let configBackup: string | undefined;
    if (configDirty && config) {
      configBackup = backup(paths, paths.claudeJson);
      writeJsonAtomic(paths.claudeJson, config);
    }
    if (settingsDirty && settings) {
      const b = backup(paths, settingsPath);
      writeJsonAtomic(settingsPath, settings);
      for (const r of results) if (r.scope === "plugin" && r.ok) r.backup = b;
    }
    if (parkedDirty) {
      const file = parkedFile(paths);
      mkdirSync(join(file, ".."), { recursive: true });
      writeJsonAtomic(file, parked);
    }
    for (const r of results) if (r.ok && r.scope !== "plugin" && configBackup) r.backup = configBackup;
  }
  return results;
}
