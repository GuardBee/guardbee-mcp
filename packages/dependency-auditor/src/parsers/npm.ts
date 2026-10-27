import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parsePnpmLock, parseYarnLock, parseBunLock, toDeps } from "./npm-locks.js";
import type { GraphNode } from "./graph.js";

export interface Dependency {
  name: string;
  version: string;
  isDev: boolean;
  source: "direct" | "lockfile";
  /** File the version came from, e.g. `pnpm-lock.yaml`. */
  file?: string;
  /**
   * How the package gets installed: `name@version` from a direct dependency
   * down to this package (length 1 for a direct dependency). Only set when
   * the lockfile records the dependency graph.
   */
  path?: string[];
}

function cleanVersion(v: string): string {
  // Strip semver range operators: ^1.2.3 → 1.2.3
  return v.replace(/^[\^~>=<]+/, "").split(" ")[0] ?? v;
}

type LockPackage = {
  version?: string;
  dev?: boolean;
  link?: boolean;
  name?: string;
  dependencies?: Record<string, LockPackage>;
};

/** Package name is the path after the last `node_modules/` segment (scoped names included). */
function nameFromLockPath(pkgPath: string): string | null {
  const marker = "node_modules/";
  const idx = pkgPath.lastIndexOf(marker);
  if (idx === -1) return null;
  const name = pkgPath.slice(idx + marker.length);
  return name || null;
}

export function parseNpmManifest(dir: string): Dependency[] {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) return [];

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }

  const deps: Dependency[] = [];

  // Locked versions are exact; prefer any lockfile over package.json ranges.
  const locked = parseNpmLockfiles(dir, manifest);
  if (locked) return locked;

  // Fallback: parse package.json directly (versions may have ranges)
  const sections: Array<[keyof typeof manifest, boolean]> = [
    ["dependencies", false],
    ["devDependencies", true],
    ["peerDependencies", false],
    ["optionalDependencies", false],
  ];

  for (const [section, isDev] of sections) {
    const obj = manifest[section];
    if (obj && typeof obj === "object") {
      for (const [name, version] of Object.entries(obj as Record<string, string>)) {
        if (typeof version === "string") {
          deps.push({ name, version: cleanVersion(version), isDev, source: "direct" });
        }
      }
    }
  }

  return deps.map((d) => ({ ...d, file: "package.json" }));
}

const NPM_LOCKFILES: Array<[string, (content: string, manifest: Record<string, unknown>) => Dependency[]]> = [
  ["package-lock.json", parsePackageLock],
  ["npm-shrinkwrap.json", parsePackageLock],
  ["pnpm-lock.yaml", (c) => parsePnpmLock(c)],
  ["yarn.lock", parseYarnLock],
  ["bun.lock", (c) => parseBunLock(c)],
];

/** First lockfile in `dir` that parses to at least one package, or null. */
function parseNpmLockfiles(dir: string, manifest: Record<string, unknown>): Dependency[] | null {
  for (const [file, parse] of NPM_LOCKFILES) {
    const p = join(dir, file);
    if (!existsSync(p)) continue;
    try {
      const deps = parse(readFileSync(p, "utf8"), manifest);
      if (deps.length > 0) return deps.map((d) => ({ ...d, file }));
    } catch {
      // unreadable or unknown format: try the next lockfile, then package.json
    }
  }
  return null;
}

/** A `packages` entry of package-lock v2/v3 (dependency maps hold ranges, not nested entries). */
interface LockEntry {
  version?: string;
  name?: string;
  dev?: boolean;
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parsePackageLock(content: string): Dependency[] {
  const lock = JSON.parse(content) as {
    packages?: Record<string, LockEntry>;
    dependencies?: Record<string, LockPackage>;
  };

  // v2/v3 lock format: a flat map of install paths.
  if (lock.packages) return parsePackageLockV2(lock.packages);

  // v1 lock format (nested `dependencies` objects are transitive packages)
  const deps: Dependency[] = [];
  if (lock.dependencies) collectV1Dependencies(lock.dependencies, deps);
  return deps;
}

/** The install path Node would load `dep` from when required by the package at `from`. */
function resolveInstallPath(packages: Record<string, LockEntry>, from: string, dep: string): string | null {
  let base = from;
  for (;;) {
    const candidate = `${base ? `${base}/` : ""}node_modules/${dep}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const idx = base.lastIndexOf("node_modules/");
    base = idx <= 0 ? "" : base.slice(0, idx - 1);
  }
}

function parsePackageLockV2(packages: Record<string, LockEntry>): Dependency[] {
  const nodes = new Map<string, GraphNode>();
  const devFlag = new Map<string, boolean>();
  const edges = (from: string, info: LockEntry): string[] =>
    Object.keys({ ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies })
      .map((d) => resolveInstallPath(packages, from, d))
      .filter((d): d is string => d !== null && !packages[d]!.link);

  const prodRoots: string[] = [];
  const devRoots: string[] = [];
  for (const [pkgPath, info] of Object.entries(packages)) {
    const isMember = !pkgPath.includes("node_modules/"); // "" (root) or a workspace member
    if (isMember) {
      // Local code is not audited; its dependencies are the roots.
      prodRoots.push(
        ...Object.keys({ ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies })
          .map((d) => resolveInstallPath(packages, pkgPath, d))
          .filter((d): d is string => d !== null)
      );
      devRoots.push(
        ...Object.keys(info.devDependencies ?? {})
          .map((d) => resolveInstallPath(packages, pkgPath, d))
          .filter((d): d is string => d !== null)
      );
      continue;
    }
    if (info.link) continue; // symlink to a workspace member, handled above
    const name = info.name || nameFromLockPath(pkgPath);
    if (!name || !info.version) continue;
    nodes.set(pkgPath, { name, version: info.version, deps: edges(pkgPath, info) });
    devFlag.set(pkgPath, !!info.dev);
  }
  return toDeps(nodes, prodRoots, devRoots, devFlag);
}

function collectV1Dependencies(tree: Record<string, LockPackage>, deps: Dependency[]): void {
  for (const [name, info] of Object.entries(tree)) {
    if (info.version) {
      deps.push({ name, version: info.version, isDev: !!info.dev, source: "lockfile" });
    }
    if (info.dependencies) collectV1Dependencies(info.dependencies, deps);
  }
}
