import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { resolvePaths, type ClaudePaths } from "./paths.js";

/** Writes beside the target and renames, so a crash never leaves Claude Code with half a config. */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.guardbee-${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Copies `file` into `<backupDir>/<name>.<timestamp>` and returns the copy's path. */
export function backupFile(file: string, backupDir: string): string {
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `${basename(file)}.${Date.now()}`);
  copyFileSync(file, target);
  return target;
}

export interface HookSpec {
  /** Claude Code hook event: SessionStart, UserPromptSubmit, Stop, ... */
  event: string;
  command: string;
  matcher?: string;
  /** Seconds */
  timeout?: number;
}

export interface HookChange {
  event: string;
  action: "add" | "replace" | "remove";
  command: string;
}

export interface HookInstallResult {
  settingsPath: string;
  changes: HookChange[];
  applied: boolean;
  backup?: string;
}

interface HookGroup {
  matcher?: string;
  hooks: Array<{ type: string; command?: string; timeout?: number }>;
}

/**
 * Hooks this package owns carry a trailing shell comment with `tag`, so they can be found again
 * among the person's own hooks and replaced or removed without touching anything else.
 */
export function taggedCommand(command: string, tag: string): string {
  return `${command} # ${tag}`;
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function settingsPathOf(paths?: Partial<ClaudePaths>): string {
  return join(resolvePaths(paths).claudeDir, "settings.json");
}

function stripTagged(hooks: Record<string, HookGroup[]>, tag: string): HookChange[] {
  const removed: HookChange[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept: HookGroup[] = [];
    for (const group of groups) {
      const own = (group.hooks ?? []).filter((h) => h.command?.includes(`# ${tag}`));
      for (const h of own) removed.push({ event, action: "remove", command: h.command ?? "" });
      const rest = (group.hooks ?? []).filter((h) => !h.command?.includes(`# ${tag}`));
      if (rest.length) kept.push({ ...group, hooks: rest });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return removed;
}

/**
 * Adds `specs` to ~/.claude/settings.json, replacing this tag's earlier entries, and leaves every
 * other hook in place. Dry run unless `apply`; a backup of settings.json is taken before writing.
 */
export function installHooks(
  specs: HookSpec[],
  tag: string,
  options: { paths?: Partial<ClaudePaths>; apply?: boolean; backupDir?: string } = {}
): HookInstallResult {
  const settingsPath = settingsPathOf(options.paths);
  const settings = readSettings(settingsPath);
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const previous = new Set(stripTagged(hooks, tag).map((c) => c.event));
  const changes: HookChange[] = [];
  for (const spec of specs) {
    const command = taggedCommand(spec.command, tag);
    const group: HookGroup = { hooks: [{ type: "command", command, ...(spec.timeout ? { timeout: spec.timeout } : {}) }] };
    if (spec.matcher) group.matcher = spec.matcher;
    (hooks[spec.event] ??= []).push(group);
    const label = spec.matcher ? `${spec.event} [${spec.matcher}]` : spec.event;
    changes.push({ event: label, action: previous.has(spec.event) ? "replace" : "add", command });
  }
  settings.hooks = hooks;
  return commit(settingsPath, settings, changes, options);
}

export function uninstallHooks(
  tag: string,
  options: { paths?: Partial<ClaudePaths>; apply?: boolean; backupDir?: string } = {}
): HookInstallResult {
  const settingsPath = settingsPathOf(options.paths);
  const settings = readSettings(settingsPath);
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const changes = stripTagged(hooks, tag);
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  return commit(settingsPath, settings, changes, options);
}

function commit(
  settingsPath: string,
  settings: Record<string, unknown>,
  changes: HookChange[],
  options: { paths?: Partial<ClaudePaths>; apply?: boolean; backupDir?: string }
): HookInstallResult {
  if (!options.apply || changes.length === 0) return { settingsPath, changes, applied: false };
  const backupDir = options.backupDir ?? join(resolvePaths(options.paths).stateDir, "backups");
  const backup = existsSync(settingsPath) ? backupFile(settingsPath, backupDir) : undefined;
  writeJsonAtomic(settingsPath, settings);
  return { settingsPath, changes, applied: true, backup };
}

export function listTaggedHooks(tag: string, paths?: Partial<ClaudePaths>): HookChange[] {
  let settings: Record<string, unknown>;
  try {
    settings = readSettings(settingsPathOf(paths));
  } catch {
    return [];
  }
  const out: HookChange[] = [];
  for (const [event, groups] of Object.entries((settings.hooks ?? {}) as Record<string, HookGroup[]>)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const h of group.hooks ?? []) if (h.command?.includes(`# ${tag}`)) out.push({ event, action: "add", command: h.command });
    }
  }
  return out;
}

/**
 * How a hook should start this CLI. A global or project install has a stable path; under npx the
 * script sits in a cache that can be cleaned, so the hook goes through npx with a pinned version.
 */
export function selfCommand(scriptPath: string | undefined, pkg: string, version: string): string {
  if (scriptPath && !/[\\/]_npx[\\/]/.test(scriptPath)) return `node ${JSON.stringify(scriptPath)}`;
  return `npx -y ${pkg}@${version}`;
}

export function formatHookResult(result: HookInstallResult): string {
  if (result.changes.length === 0) return `No changes to ${result.settingsPath}.`;
  const lines = result.changes.map((c) => `${c.action.padEnd(7)} ${c.event}: ${c.command}`);
  lines.unshift(`${result.applied ? "Updated" : "Would update"} ${result.settingsPath}:`);
  if (result.backup) lines.push(`Backup: ${result.backup}`);
  if (!result.applied) lines.push("", "Dry run: nothing written. Apply to write it (takes effect in new Claude Code sessions).");
  return lines.join("\n");
}

/** Reads a hook's JSON input from stdin; resolves to {} when there is none or it is not JSON. */
export async function readHookInput(stream: NodeJS.ReadableStream = process.stdin, timeoutMs = 2000): Promise<Record<string, unknown>> {
  if ((stream as NodeJS.ReadStream).isTTY) return {};
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(parse()), timeoutMs);
    function parse(): Record<string, unknown> {
      try {
        const v = JSON.parse(data);
        return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }
    stream.setEncoding?.("utf8");
    stream.on("data", (chunk) => (data += chunk));
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(parse());
    });
    stream.on("error", () => {
      clearTimeout(timer);
      resolve({});
    });
  });
}
