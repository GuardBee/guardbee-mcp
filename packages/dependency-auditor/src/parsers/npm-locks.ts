import { parse as parseYaml } from "yaml";
import type { Dependency } from "./npm.js";
import { devOnly, splitNameVersion, type GraphNode } from "./graph.js";

type Manifest = Record<string, unknown>;

/** Root dependency names from package.json, split into production and dev. */
function manifestRoots(manifest: Manifest): { prod: Array<[string, string]>; dev: Array<[string, string]> } {
  const pick = (key: string): Array<[string, string]> => {
    const obj = manifest[key];
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    );
  };
  return {
    prod: [...pick("dependencies"), ...pick("optionalDependencies"), ...pick("peerDependencies")],
    dev: pick("devDependencies"),
  };
}

function toDeps(nodes: Map<string, GraphNode>, dev: Set<string>): Dependency[] {
  const out: Dependency[] = [];
  const seen = new Set<string>();
  for (const [id, n] of nodes) {
    const key = `${n.name}@${n.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: n.name, version: n.version, isDev: dev.has(id), source: "lockfile" });
  }
  return out;
}

const LOCAL_PROTOCOL = /^(link|file|workspace|portal|git|github|git\+[a-z]+|https?):/;

// ── pnpm-lock.yaml ────────────────────────────────────────────────────────────

type PnpmDepMap = Record<string, string | { version?: string }>;
interface PnpmPackage {
  dev?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
interface PnpmLock {
  lockfileVersion?: string | number;
  importers?: Record<string, Record<string, PnpmDepMap>>;
  dependencies?: PnpmDepMap;
  devDependencies?: PnpmDepMap;
  optionalDependencies?: PnpmDepMap;
  packages?: Record<string, PnpmPackage>;
  snapshots?: Record<string, PnpmPackage | null>;
}

/** Strip peer suffixes: `1.0.0(react@18.0.0)` (v6/v9) and `1.0.0_react@18.0.0` (v5). */
function pnpmBareVersion(v: string): string {
  const paren = v.indexOf("(");
  const bare = paren === -1 ? v : v.slice(0, paren);
  return bare.split("_")[0] ?? bare;
}

/** `/name@1.0.0(peer)` (v6), `/name/1.0.0_peer` (v5) or `name@1.0.0(peer)` (v9) → [name, version]. */
function pnpmKey(key: string, v5: boolean): [string, string] | null {
  let k = key.startsWith("/") ? key.slice(1) : key;
  const paren = k.indexOf("(");
  if (paren !== -1) k = k.slice(0, paren);
  if (v5) {
    const slash = k.lastIndexOf("/");
    if (slash <= 0) return null;
    return [k.slice(0, slash), pnpmBareVersion(k.slice(slash + 1))];
  }
  return splitNameVersion(k);
}

/** Snapshot id for a dependency entry `name: version` (v9). Aliases carry `real@version`. */
function pnpmDepId(name: string, version: string): string | null {
  if (LOCAL_PROTOCOL.test(version)) return null;
  if (/^(@[^/]+\/)?[^@/]+@/.test(version) && !/^[0-9]/.test(version)) return version;
  return `${name}@${version}`;
}

export function parsePnpmLock(content: string): Dependency[] {
  const lock = parseYaml(content) as PnpmLock | null;
  if (!lock || typeof lock !== "object") return [];
  const version = String(lock.lockfileVersion ?? "");
  const v5 = version.startsWith("5");

  // v5/v6 mark dev packages directly.
  if (!lock.snapshots) {
    const out: Dependency[] = [];
    for (const [key, info] of Object.entries(lock.packages ?? {})) {
      const nv = pnpmKey(key, v5);
      if (!nv) continue;
      out.push({ name: nv[0], version: pnpmBareVersion(nv[1]), isDev: info?.dev === true, source: "lockfile" });
    }
    return out;
  }

  // v9: walk importers → snapshots.
  const nodes = new Map<string, GraphNode>();
  for (const [id, snap] of Object.entries(lock.snapshots)) {
    const nv = pnpmKey(id, false);
    if (!nv) continue;
    const deps: string[] = [];
    for (const map of [snap?.dependencies, snap?.optionalDependencies]) {
      for (const [n, v] of Object.entries(map ?? {})) {
        const d = pnpmDepId(n, String(v));
        if (d) deps.push(d);
      }
    }
    nodes.set(id, { name: nv[0], version: pnpmBareVersion(nv[1]), deps });
  }

  const prodRoots: string[] = [];
  const devRoots: string[] = [];
  const importers = lock.importers ?? { ".": lock as unknown as Record<string, PnpmDepMap> };
  for (const imp of Object.values(importers)) {
    for (const [section, roots] of [
      ["dependencies", prodRoots],
      ["optionalDependencies", prodRoots],
      ["devDependencies", devRoots],
    ] as const) {
      for (const [n, spec] of Object.entries(imp?.[section] ?? {})) {
        const v = typeof spec === "string" ? spec : spec?.version;
        const d = v ? pnpmDepId(n, v) : null;
        if (d) roots.push(d);
      }
    }
  }

  return toDeps(nodes, devOnly(nodes, prodRoots, devRoots));
}

// ── yarn.lock (v1 and berry) ──────────────────────────────────────────────────

/** Descriptor list from a yarn.lock entry key: `"a@^1", a@^1.2` → ["a@^1", "a@^1.2"]. */
function yarnDescriptors(keyLine: string): string[] {
  return keyLine
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function parseYarnV1(content: string): Map<string, GraphNode & { descriptors: string[] }> {
  const entries = new Map<string, GraphNode & { descriptors: string[] }>();
  let current: (GraphNode & { descriptors: string[] }) | null = null;
  let inDeps = false;
  let index = 0;

  for (const raw of content.split("\n")) {
    if (!raw.trim() || raw.startsWith("#")) continue;
    if (!raw.startsWith(" ")) {
      const descriptors = yarnDescriptors(raw.replace(/:\s*$/, ""));
      const nv = descriptors[0] ? splitNameVersion(descriptors[0]) : null;
      current = nv ? { name: nv[0], version: "", deps: [], descriptors } : null;
      if (current) entries.set(String(index++), current);
      inDeps = false;
      continue;
    }
    if (!current) continue;
    const line = raw.trim();
    if (/^(dependencies|optionalDependencies):$/.test(line)) {
      inDeps = true;
      continue;
    }
    if (raw.startsWith("    ") && inDeps) {
      const m = line.match(/^"?([^"\s]+)"?\s+"?([^"]+)"?$/);
      if (m) current.deps.push(`${m[1]}@${m[2]}`);
      continue;
    }
    inDeps = false;
    const ver = line.match(/^version\s+"?([^"]+)"?$/);
    if (ver) current.version = ver[1]!;
  }
  return entries;
}

interface BerryEntry {
  version?: string;
  resolution?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function parseYarnBerry(content: string): Map<string, GraphNode & { descriptors: string[] }> {
  const doc = parseYaml(content) as Record<string, BerryEntry> | null;
  const entries = new Map<string, GraphNode & { descriptors: string[] }>();
  let index = 0;
  for (const [key, info] of Object.entries(doc ?? {})) {
    if (key === "__metadata" || !info?.resolution || !info.version) continue;
    const at = info.resolution.lastIndexOf("@npm:");
    if (at <= 0) continue; // workspace:, patch:, link:, git …
    const deps = Object.entries({ ...info.dependencies, ...info.optionalDependencies }).map(
      ([n, r]) => `${n}@${r}`
    );
    entries.set(String(index++), {
      name: info.resolution.slice(0, at),
      version: info.version,
      deps,
      descriptors: yarnDescriptors(key),
    });
  }
  return entries;
}

export function parseYarnLock(content: string, manifest: Manifest): Dependency[] {
  const berry = /^__metadata:/m.test(content);
  const entries = berry ? parseYarnBerry(content) : parseYarnV1(content);

  const byDescriptor = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const [id, e] of entries) {
    for (const d of e.descriptors) byDescriptor.set(d, id);
    byName.set(e.name, [...(byName.get(e.name) ?? []), id]);
  }

  // Exact descriptor first (`ms@2.0.0`, `ms@npm:2.0.0`); otherwise any entry with that name.
  const resolve = (name: string, range: string): string[] => {
    const bare = range.replace(/^npm:/, "");
    const hit = byDescriptor.get(`${name}@${bare}`) ?? byDescriptor.get(`${name}@npm:${bare}`);
    return hit ? [hit] : (byName.get(name) ?? []);
  };
  const resolveDescriptor = (d: string): string[] => {
    const at = d.indexOf("@", 1);
    return at === -1 ? [] : resolve(d.slice(0, at), d.slice(at + 1));
  };

  const nodes = new Map<string, GraphNode>();
  for (const [id, e] of entries) {
    if (!e.version) continue;
    nodes.set(id, { name: e.name, version: e.version, deps: e.deps.flatMap(resolveDescriptor) });
  }

  const roots = manifestRoots(manifest);
  const prodRoots = roots.prod.flatMap(([n, r]) => resolve(n, r));
  const devRoots = roots.dev.flatMap(([n, r]) => resolve(n, r));
  return toDeps(nodes, devOnly(nodes, prodRoots, devRoots));
}

// ── bun.lock (text format, bun ≥ 1.2) ─────────────────────────────────────────

/** bun.lock is JSON with trailing commas. Remove commas before `}`/`]` outside strings. */
function stripTrailingCommas(src: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    if (c === ",") {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      if (src[j] === "}" || src[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

/** `a/@s/b/c` → ["a", "@s/b", "c"]. */
function bunKeySegments(key: string): string[] {
  const parts = key.split("/");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith("@") && i + 1 < parts.length) out.push(`${p}/${parts[++i]}`);
    else out.push(p);
  }
  return out;
}

type BunPackage = [string, string?, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }?, string?];
interface BunWorkspace {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export function parseBunLock(content: string): Dependency[] {
  const lock = JSON.parse(stripTrailingCommas(content)) as {
    workspaces?: Record<string, BunWorkspace>;
    packages?: Record<string, BunPackage>;
  };
  const packages = lock.packages ?? {};

  // A dependency of key P resolves to the nearest `P/dep`, walking up to the top-level `dep`.
  const resolveFrom = (parent: string[], dep: string): string | null => {
    for (let n = parent.length; n >= 0; n--) {
      const key = [...parent.slice(0, n), dep].join("/");
      if (packages[key]) return key;
    }
    return null;
  };

  const nodes = new Map<string, GraphNode>();
  for (const [key, entry] of Object.entries(packages)) {
    const nv = Array.isArray(entry) && typeof entry[0] === "string" ? splitNameVersion(entry[0]) : null;
    if (!nv || nv[1].includes(":")) continue; // workspace:, github:, file: …
    const meta = entry[2] ?? {};
    const segs = bunKeySegments(key);
    const deps = Object.keys({ ...meta.dependencies, ...meta.optionalDependencies })
      .map((d) => resolveFrom(segs, d))
      .filter((d): d is string => d !== null);
    nodes.set(key, { name: nv[0], version: nv[1], deps });
  }

  const prodRoots: string[] = [];
  const devRoots: string[] = [];
  for (const ws of Object.values(lock.workspaces ?? {})) {
    for (const n of Object.keys({ ...ws.dependencies, ...ws.optionalDependencies, ...ws.peerDependencies })) {
      if (packages[n]) prodRoots.push(n);
    }
    for (const n of Object.keys(ws.devDependencies ?? {})) {
      if (packages[n]) devRoots.push(n);
    }
  }

  return toDeps(nodes, devOnly(nodes, prodRoots, devRoots));
}
