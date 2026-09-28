import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface DeclaredDependency {
  name: string;
  isDev: boolean;
}

/**
 * Only the manifest's *own* declared sections — deliberately not the
 * lockfile's full resolved tree. Slopsquatting is a risk at the moment a
 * name gets typed (by a human or an AI coding assistant) into package.json;
 * transitive dependencies were already vetted by whichever maintainer
 * published the package that depends on them.
 */
export function parseNpmDirectDependencies(dir: string): DeclaredDependency[] {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) return [];

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }

  const deps: DeclaredDependency[] = [];
  const sections: Array<[string, boolean]> = [
    ["dependencies", false],
    ["devDependencies", true],
    ["peerDependencies", false],
    ["optionalDependencies", false],
  ];

  for (const [section, isDev] of sections) {
    const obj = manifest[section];
    if (obj && typeof obj === "object") {
      for (const name of Object.keys(obj as Record<string, string>)) {
        deps.push({ name, isDev });
      }
    }
  }

  return deps;
}
