import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseToml } from "smol-toml";
import type { Ecosystem } from "../osv.js";
import type { Dependency } from "./npm.js";
import { toDeps } from "./npm-locks.js";
import type { GraphNode } from "./graph.js";

// ── Cargo.lock (crates.io) ────────────────────────────────────────────────────

interface CargoPackage {
  name?: string;
  version?: string;
  source?: string;
  dependencies?: string[];
}

/** Names in [dev-dependencies] of a Cargo.toml (the lockfile does not record dev-only crates). */
function cargoDevNames(cargoToml: string | undefined): Set<string> {
  if (!cargoToml) return new Set();
  try {
    const doc = parseToml(cargoToml) as Record<string, unknown>;
    const names = new Set(Object.keys((doc["dev-dependencies"] as object) ?? {}));
    for (const t of Object.values((doc["target"] as Record<string, Record<string, object>>) ?? {})) {
      for (const n of Object.keys(t["dev-dependencies"] ?? {})) names.add(n);
    }
    return names;
  } catch {
    return new Set();
  }
}

export function parseCargoLock(content: string, cargoToml?: string): Dependency[] {
  const doc = parseToml(content) as { package?: CargoPackage[] };
  const pkgs = (doc.package ?? []).filter((p) => p.name && p.version);
  const idsByName = new Map<string, string[]>();
  for (const p of pkgs) idsByName.set(p.name!, [...(idsByName.get(p.name!) ?? []), `${p.name}@${p.version}`]);

  // "name", "name version" or "name version (source)"
  const resolve = (ref: string): string[] => {
    const [name, version] = ref.split(" ");
    if (!name) return [];
    return version ? [`${name}@${version}`] : (idsByName.get(name) ?? []);
  };

  const devNames = cargoDevNames(cargoToml);
  const nodes = new Map<string, GraphNode>();
  const prodRoots: string[] = [];
  const devRoots: string[] = [];
  for (const p of pkgs) {
    const id = `${p.name}@${p.version}`;
    const deps = (p.dependencies ?? []).flatMap(resolve);
    if (!p.source) {
      // Workspace member (local crate): not audited; its dependencies are the roots.
      for (const ref of p.dependencies ?? []) {
        (devNames.has(ref.split(" ")[0]!) ? devRoots : prodRoots).push(...resolve(ref));
      }
      continue;
    }
    // git sources are not crates.io releases.
    if (!p.source.startsWith("registry+") && !p.source.startsWith("sparse+")) continue;
    nodes.set(id, { name: p.name!, version: p.version!, deps });
  }
  return toDeps(nodes, prodRoots, devRoots);
}

// ── go.mod (Go modules) ───────────────────────────────────────────────────────

/**
 * go.mod lists every module in the build (Go ≥ 1.17), marking those not
 * imported directly with `// indirect`. It has no edges, so only direct
 * modules get a path. `replace` directives are applied; local replacements
 * are skipped.
 */
export function parseGoMod(content: string): Dependency[] {
  const requires: Array<{ mod: string; version: string; indirect: boolean }> = [];
  const replaces: Array<{ from: string; fromVersion?: string; to: string; toVersion?: string }> = [];
  let block: "require" | "replace" | null = null;

  for (const raw of content.split("\n")) {
    const indirect = /\/\/\s*indirect/.test(raw);
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (line === ")") {
      block = null;
      continue;
    }
    const open = /^(require|replace)\s*\($/.exec(line);
    if (open) {
      block = open[1] as "require" | "replace";
      continue;
    }
    const single = /^(require|replace)\s+(.+)$/.exec(line);
    const kind = single ? single[1] : block;
    const body = single ? single[2]! : line;
    if (kind === "require") {
      const [mod, version] = body.split(/\s+/);
      if (mod && version) requires.push({ mod, version, indirect });
    } else if (kind === "replace") {
      const [left, right] = body.split("=>").map((s) => s.trim().split(/\s+/));
      if (left?.[0] && right?.[0]) replaces.push({ from: left[0], fromVersion: left[1], to: right[0], toVersion: right[1] });
    }
  }

  const out: Dependency[] = [];
  for (const r of requires) {
    const rep = replaces.find((x) => x.from === r.mod && (!x.fromVersion || x.fromVersion === r.version));
    if (rep && !rep.toVersion) continue; // replaced by a local directory
    const name = rep ? rep.to : r.mod;
    const version = rep ? rep.toVersion! : r.version;
    out.push({
      name,
      version,
      isDev: false,
      source: "lockfile",
      ...(r.indirect ? {} : { path: [`${name}@${version}`] }),
    });
  }
  return out;
}

// ── Gemfile.lock (RubyGems) ───────────────────────────────────────────────────

/** Gems declared only inside `group :development / :test do … end` blocks of a Gemfile. */
function gemfileDevNames(gemfile: string | undefined): Set<string> {
  const dev = new Set<string>();
  const prod = new Set<string>();
  if (!gemfile) return dev;
  const stack: boolean[] = [];
  for (const raw of gemfile.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const group = /^group\s+(.+?)\s+do\b/.exec(line);
    if (group) {
      const groups = group[1]!.match(/:(\w+)|["'](\w+)["']/g)?.map((g) => g.replace(/[:"']/g, "")) ?? [];
      stack.push(groups.length > 0 && groups.every((g) => g === "development" || g === "test"));
      continue;
    }
    if (/^(platforms?|source|install_if|path|git)\b.*\bdo\b/.test(line)) {
      stack.push(stack[stack.length - 1] ?? false);
      continue;
    }
    if (line === "end") {
      stack.pop();
      continue;
    }
    const gem = /^gem\s+["']([^"']+)["']/.exec(line);
    if (!gem) continue;
    const inlineDev = /group:\s*\[?\s*:(development|test)/.test(line) || /groups?:\s*\[\s*:(development|test)(\s*,\s*:(development|test))*\s*\]/.test(line);
    (stack[stack.length - 1] || inlineDev ? dev : prod).add(gem[1]!);
  }
  return new Set([...dev].filter((n) => !prod.has(n)));
}

/** `1.19.4-aarch64-linux-gnu` → `1.19.4` (platform builds share the release's advisories). */
function gemVersion(v: string): string {
  return v.split("-")[0]!;
}

export function parseGemfileLock(content: string, gemfile?: string): Dependency[] {
  const nodes = new Map<string, GraphNode>();
  const idByName = new Map<string, string>();
  const directs: string[] = [];
  let section = "";
  let inSpecs = false;
  let current: GraphNode | null = null;

  for (const raw of content.split("\n")) {
    if (/^[A-Z]/.test(raw)) {
      section = raw.trim();
      inSpecs = false;
      current = null;
      continue;
    }
    if (section === "GEM" && raw.trim() === "specs:") {
      inSpecs = true;
      continue;
    }
    if (section === "GEM" && inSpecs) {
      const spec = /^ {4}(\S+) \(([^)]+)\)$/.exec(raw);
      if (spec) {
        const name = spec[1]!;
        const version = gemVersion(spec[2]!);
        const id = `${name}@${version}`;
        current = nodes.get(id) ?? { name, version, deps: [] };
        nodes.set(id, current);
        idByName.set(name, id);
        continue;
      }
      const dep = /^ {6}(\S+)/.exec(raw);
      if (dep && current) current.deps.push(dep[1]!);
      continue;
    }
    if (section === "DEPENDENCIES") {
      const d = /^ {2}([^\s!(]+)/.exec(raw);
      if (d) directs.push(d[1]!);
    }
    // GIT / PATH sections are not RubyGems releases and are skipped.
  }

  for (const n of nodes.values()) n.deps = n.deps.map((name) => idByName.get(name)).filter((d): d is string => !!d);
  const devNames = gemfileDevNames(gemfile);
  const roots = (names: string[]) => names.map((n) => idByName.get(n)).filter((d): d is string => !!d);
  return toDeps(
    nodes,
    roots(directs.filter((n) => !devNames.has(n))),
    roots(directs.filter((n) => devNames.has(n)))
  );
}

// ── composer.lock (Packagist) ─────────────────────────────────────────────────

interface ComposerPackage {
  name?: string;
  version?: string;
  require?: Record<string, string>;
}

export function parseComposerLock(content: string, composerJson?: string): Dependency[] {
  const lock = JSON.parse(content) as { packages?: ComposerPackage[]; "packages-dev"?: ComposerPackage[] };
  const nodes = new Map<string, GraphNode>();
  const idByName = new Map<string, string>();
  const devFlag = new Map<string, boolean>();
  for (const [list, isDev] of [[lock.packages, false], [lock["packages-dev"], true]] as const) {
    for (const p of list ?? []) {
      // dev-main / dev-feature branches are not tagged releases.
      if (!p.name || !p.version || p.version.startsWith("dev-")) continue;
      const id = `${p.name}@${p.version}`;
      nodes.set(id, { name: p.name, version: p.version, deps: Object.keys(p.require ?? {}) });
      idByName.set(p.name.toLowerCase(), id);
      devFlag.set(id, isDev);
    }
  }
  // Platform requirements (php, ext-json, composer-plugin-api) match no locked package and drop out here.
  for (const n of nodes.values()) {
    n.deps = n.deps.map((d) => idByName.get(d.toLowerCase())).filter((d): d is string => !!d);
  }

  let prodRoots: string[] = [];
  let devRoots: string[] = [];
  if (composerJson) {
    try {
      const manifest = JSON.parse(composerJson) as { require?: object; "require-dev"?: object };
      const ids = (o: object | undefined) =>
        Object.keys(o ?? {}).map((n) => idByName.get(n.toLowerCase())).filter((d): d is string => !!d);
      prodRoots = ids(manifest.require);
      devRoots = ids(manifest["require-dev"]);
    } catch {
      // no paths without a readable composer.json
    }
  }
  return toDeps(nodes, prodRoots, devRoots, devFlag);
}

// ── Detection ─────────────────────────────────────────────────────────────────

function read(dir: string, file: string): string | undefined {
  const p = join(dir, file);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
}

/** Cargo, Go, RubyGems and Composer projects in `dir`, each with its OSV ecosystem. */
export function parseOtherEcosystems(dir: string): Array<{ ecosystem: Ecosystem; label: string; deps: Dependency[] }> {
  const found: Array<{ ecosystem: Ecosystem; label: string; deps: Dependency[] }> = [];
  const add = (ecosystem: Ecosystem, label: string, file: string, parse: () => Dependency[]) => {
    try {
      const deps = parse();
      if (deps.length > 0) found.push({ ecosystem, label, deps: deps.map((d) => ({ ...d, file })) });
    } catch {
      // unreadable or unknown format: skip this ecosystem
    }
  };

  const cargo = read(dir, "Cargo.lock");
  if (cargo) add("crates.io", "cargo", "Cargo.lock", () => parseCargoLock(cargo, read(dir, "Cargo.toml")));
  const gomod = read(dir, "go.mod");
  if (gomod) add("Go", "go", "go.mod", () => parseGoMod(gomod));
  const gems = read(dir, "Gemfile.lock") ?? read(dir, "gems.locked");
  if (gems) add("RubyGems", "ruby", "Gemfile.lock", () => parseGemfileLock(gems, read(dir, "Gemfile") ?? read(dir, "gems.rb")));
  const composer = read(dir, "composer.lock");
  if (composer) add("Packagist", "composer", "composer.lock", () => parseComposerLock(composer, read(dir, "composer.json")));
  return found;
}
