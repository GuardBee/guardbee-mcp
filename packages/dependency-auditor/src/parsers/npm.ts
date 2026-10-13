import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parsePnpmLock, parseYarnLock, parseBunLock } from "./npm-locks.js";

export interface Dependency {
  name: string;
  version: string;
  isDev: boolean;
  source: "direct" | "lockfile";
  /** File the version came from, e.g. `pnpm-lock.yaml`. */
  file?: string;
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

function parsePackageLock(content: string): Dependency[] {
  const lock = JSON.parse(content) as {
    packages?: Record<string, LockPackage>;
    dependencies?: Record<string, LockPackage>;
  };
  const deps: Dependency[] = [];

  // v2/v3 lock format
  if (lock.packages) {
    for (const [pkgPath, info] of Object.entries(lock.packages)) {
      if (!pkgPath) continue; // root
      // Workspace members (`packages/foo`) and their symlinks are local code, not registry packages.
      if (info.link || !pkgPath.includes("node_modules/")) continue;
      const name = info.name || nameFromLockPath(pkgPath);
      if (name && info.version) {
        deps.push({ name, version: info.version, isDev: !!info.dev, source: "lockfile" });
      }
    }
    return deps;
  }

  // v1 lock format (nested `dependencies` objects are transitive packages)
  if (lock.dependencies) collectV1Dependencies(lock.dependencies, deps);
  return deps;
}

function collectV1Dependencies(tree: Record<string, LockPackage>, deps: Dependency[]): void {
  for (const [name, info] of Object.entries(tree)) {
    if (info.version) {
      deps.push({ name, version: info.version, isDev: !!info.dev, source: "lockfile" });
    }
    if (info.dependencies) collectV1Dependencies(info.dependencies, deps);
  }
}
