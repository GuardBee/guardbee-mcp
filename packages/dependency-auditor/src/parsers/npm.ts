import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface Dependency {
  name: string;
  version: string;
  isDev: boolean;
  source: "direct" | "lockfile";
}

function cleanVersion(v: string): string {
  // Strip semver range operators: ^1.2.3 → 1.2.3
  return v.replace(/^[\^~>=<]+/, "").split(" ")[0] ?? v;
}

type LockPackage = {
  version?: string;
  dev?: boolean;
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

  // Try package-lock.json first (locked versions are more accurate)
  const lockPath = join(dir, "package-lock.json");
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
        packages?: Record<string, LockPackage>;
        dependencies?: Record<string, LockPackage>;
      };

      // v2/v3 lock format
      if (lock.packages) {
        for (const [pkgPath, info] of Object.entries(lock.packages)) {
          if (!pkgPath) continue; // root
          const name = info.name || nameFromLockPath(pkgPath);
          if (name && info.version) {
            deps.push({ name, version: info.version, isDev: !!info.dev, source: "lockfile" });
          }
        }
        return deps;
      }

      // v1 lock format (nested `dependencies` objects are transitive packages)
      if (lock.dependencies) {
        collectV1Dependencies(lock.dependencies, deps);
        return deps;
      }
    } catch {
      // fall through to manifest parsing
    }
  }

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
