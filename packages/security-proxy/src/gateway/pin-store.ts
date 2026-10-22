import fs from "fs";
import os from "os";
import path from "path";
import { hashToolDefinition, toolSnapshot, type ToolDefinition } from "@guardbee/guard-core";

/**
 * Approved tool definitions, kept across sessions and restarts: a server that
 * rewrites a tool between two runs (an update, a compromised package) is not
 * trusted again just because a new session pinned its new definition.
 *
 * The entries are mcp-rug-pull-detector's baseline entries (same hash, same
 * snapshot), so a baseline taken in CI can be imported.
 */
export interface PinnedTool {
  hash: string;
  /** When this definition was first trusted or approved. */
  firstSeen: string;
  snapshot: ToolDefinition;
}

export interface PinnedUpstream {
  serverInfo?: { name: string; version: string };
  tools: Record<string, PinnedTool>;
}

interface PinFile {
  version: 1;
  upstreams: Record<string, PinnedUpstream>;
}

export type PinChange =
  | { kind: "changed"; tool: string; pinned: PinnedTool; current: ToolDefinition; currentHash: string }
  | { kind: "added"; tool: string; current: ToolDefinition; currentHash: string }
  | { kind: "removed"; tool: string; pinned: PinnedTool };

export interface PinCheck {
  /** The upstream had no pins: everything it listed is now pinned (trust on first use). */
  firstUse: boolean;
  changes: PinChange[];
}

export function defaultPinFile(): string {
  return process.env["GUARDBEE_PINS_FILE"] || path.join(os.homedir(), ".guardbee", "pins.json");
}

const named = (tool: { name?: unknown }): tool is ToolDefinition => typeof tool.name === "string";

export class PinStore {
  private data: PinFile;

  constructor(readonly file: string = defaultPinFile()) {
    this.data = PinStore.read(file);
  }

  private static read(file: string): PinFile {
    if (!fs.existsSync(file)) return { version: 1, upstreams: {} };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PinFile>;
    if (parsed.version !== 1 || typeof parsed.upstreams !== "object" || parsed.upstreams === null) {
      throw new Error(`${file} is not a GuardBee pin file (version 1)`);
    }
    return { version: 1, upstreams: parsed.upstreams };
  }

  upstreams(): Record<string, PinnedUpstream> {
    return this.data.upstreams;
  }

  /**
   * Compare a tools/list with the pins. An upstream seen for the first time is
   * pinned as listed and saved; otherwise nothing changes until approve().
   */
  check(upstream: string, tools: readonly { name?: unknown }[]): PinCheck {
    const listed = tools.filter(named);
    const pinned = this.data.upstreams[upstream];
    if (!pinned) {
      this.approve(upstream, listed);
      return { firstUse: true, changes: [] };
    }
    const changes: PinChange[] = [];
    const seen = new Set<string>();
    for (const tool of listed) {
      seen.add(tool.name);
      const current = toolSnapshot(tool);
      const currentHash = hashToolDefinition(current);
      const entry = pinned.tools[tool.name];
      if (!entry) changes.push({ kind: "added", tool: tool.name, current, currentHash });
      else if (entry.hash !== currentHash) changes.push({ kind: "changed", tool: tool.name, pinned: entry, current, currentHash });
    }
    for (const [name, entry] of Object.entries(pinned.tools)) {
      if (!seen.has(name)) changes.push({ kind: "removed", tool: name, pinned: entry });
    }
    return { firstUse: false, changes };
  }

  /** Trust these definitions from now on (all of an upstream's tools, or some) and save. */
  approve(upstream: string, tools: readonly ToolDefinition[], serverInfo?: { name: string; version: string }): void {
    const entry = (this.data.upstreams[upstream] ??= { tools: {} });
    if (serverInfo) entry.serverInfo = serverInfo;
    const now = new Date().toISOString();
    for (const tool of tools) {
      const snapshot = toolSnapshot(tool);
      entry.tools[tool.name] = { hash: hashToolDefinition(snapshot), firstSeen: now, snapshot };
    }
    this.save();
  }

  /** Forget an upstream's pins (or one tool's): the next listing is trusted on first use. */
  reset(upstream?: string, tool?: string): number {
    if (!upstream) {
      const count = Object.keys(this.data.upstreams).length;
      this.data.upstreams = {};
      this.save();
      return count;
    }
    const entry = this.data.upstreams[upstream];
    if (!entry) return 0;
    if (!tool) {
      delete this.data.upstreams[upstream];
      this.save();
      return 1;
    }
    if (!(tool in entry.tools)) return 0;
    delete entry.tools[tool];
    this.save();
    return 1;
  }

  /** Seed an upstream from an mcp-rug-pull-detector baseline file (same hashes and snapshots). */
  importBaseline(upstream: string, baseline: { serverInfo?: { name: string; version: string }; tools: Record<string, PinnedTool> }): number {
    const tools = Object.values(baseline.tools ?? {});
    for (const entry of tools) {
      if (hashToolDefinition(entry.snapshot) !== entry.hash) {
        throw new Error(`baseline entry "${entry.snapshot?.name}" does not match its hash; refusing to import it`);
      }
    }
    const target = (this.data.upstreams[upstream] ??= { tools: {} });
    if (baseline.serverInfo) target.serverInfo = baseline.serverInfo;
    for (const entry of tools) target.tools[entry.snapshot.name] = entry;
    this.save();
    return tools.length;
  }

  /** Atomic (temp file + rename) and private: mode 0600 in a 0700 directory. */
  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
}

const MAX_SHOWN = 400;
const clip = (text: string | undefined) => {
  if (text === undefined) return "(none)";
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}… (${text.length - MAX_SHOWN} more characters)` : text;
};

/** What changed, for a person deciding whether to trust it (the approval prompt). */
export function describeChange(change: PinChange): string {
  if (change.kind === "added") return `New tool "${change.tool}": ${clip(change.current.description)}`;
  if (change.kind === "removed") return `Tool "${change.tool}" is gone`;
  const fields = (["description", "inputSchema", "outputSchema", "annotations"] as const).filter(
    (field) => JSON.stringify(change.pinned.snapshot[field] ?? null) !== JSON.stringify(change.current[field] ?? null),
  );
  const lines = [`Tool "${change.tool}" changed since it was approved (${change.pinned.firstSeen}): ${fields.join(", ")}`];
  if (fields.includes("description")) {
    lines.push(`was: ${clip(change.pinned.snapshot.description)}`, `now: ${clip(change.current.description)}`);
  }
  return lines.join("\n");
}
