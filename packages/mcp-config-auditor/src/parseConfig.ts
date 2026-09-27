import type { ParsedServer } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function stringRecord(value: unknown): Record<string, string> {
  const rec = asRecord(value);
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(rec)) {
    if (typeof entry === "string") out[key] = entry;
    else if (typeof entry === "number" || typeof entry === "boolean") out[key] = String(entry);
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function serverMap(root: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asRecord(root.mcpServers) ?? asRecord(root.servers);
  if (direct) return direct;
  const nested = asRecord(root.mcp);
  return nested ? asRecord(nested.servers) : null;
}

function parseServer(name: string, value: unknown): ParsedServer | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const url = typeof rec.url === "string" ? rec.url : typeof rec.serverUrl === "string" ? rec.serverUrl : undefined;
  return {
    name,
    command: typeof rec.command === "string" ? rec.command : undefined,
    args: stringList(rec.args),
    env: stringRecord(rec.env),
    url,
    headers: stringRecord(rec.headers),
    autoApprove: rec.autoApprove !== undefined ? rec.autoApprove : rec.alwaysAllow,
  };
}

export function parseMcpConfig(text: string): { servers: ParsedServer[]; error?: string } {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (err) {
    return { servers: [], error: err instanceof Error ? err.message : String(err) };
  }
  const rec = asRecord(root);
  if (!rec) return { servers: [], error: "Config root is not a JSON object" };
  const map = serverMap(rec);
  if (!map) return { servers: [], error: "No mcpServers, servers, or mcp.servers object found" };

  const servers: ParsedServer[] = [];
  for (const [name, value] of Object.entries(map)) {
    const parsed = parseServer(name, value);
    if (parsed) servers.push(parsed);
  }
  return { servers };
}

const LAUNCHERS = /^(npx|npm|uvx|pnpm|yarn|bunx|pipx)(\.cmd|\.exe)?$/i;
const FLAG_WITH_VALUE = new Set(["-p", "--package", "-c", "--call"]);

/** First package spec passed to a package launcher. Paths and flags are skipped. */
export function packageSpec(command: string | undefined, args: string[]): string | null {
  const base = (command ?? "").split(/[/\\]/).pop() ?? "";
  if (!LAUNCHERS.test(base)) return null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") break;
    if (arg.startsWith("-")) {
      if (FLAG_WITH_VALUE.has(arg) && args[i + 1]) {
        return args[++i] ?? null;
      }
      continue;
    }
    if (arg.startsWith(".") || arg.startsWith("/") || /^[A-Za-z]:[\\/]/.test(arg)) continue;
    return arg;
  }
  return null;
}

export function splitPackageSpec(spec: string): { name: string; version: string | null } {
  const pinnedEq = spec.match(/^(.*)==([0-9][^"]*)$/);
  if (pinnedEq) return { name: pinnedEq[1], version: pinnedEq[2] };
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) return { name: spec, version: null };
    const at = spec.indexOf("@", slash + 1);
    if (at === -1) return { name: spec, version: null };
    return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  }
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec, version: null };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

export function isPinnedVersion(version: string | null): boolean {
  if (!version) return false;
  return /^\d+\.\d+\.\d+/.test(version);
}
