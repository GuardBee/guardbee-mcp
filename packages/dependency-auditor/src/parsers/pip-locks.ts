import { parse as parseToml } from "smol-toml";
import type { Dependency } from "./npm.js";
import { devOnly, shortestPaths, pathLabels, type GraphNode } from "./graph.js";

/** PEP 503 normalized name, used to match dependency references to packages. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

// ── poetry.lock ───────────────────────────────────────────────────────────────

interface PoetryPackage {
  name?: string;
  version?: string;
  category?: string;
  groups?: string[];
  source?: { type?: string };
}

export function parsePoetryLock(content: string): Dependency[] {
  const doc = parseToml(content) as { package?: PoetryPackage[] };
  const out: Dependency[] = [];
  for (const p of doc.package ?? []) {
    if (!p.name || !p.version) continue;
    // git / directory / file / url sources are not PyPI releases.
    if (p.source?.type && p.source.type !== "legacy") continue;
    // Poetry ≥ 2 lists groups; older lockfiles use category = "main" | "dev".
    const isDev = Array.isArray(p.groups) ? !p.groups.includes("main") : p.category === "dev";
    out.push({ name: p.name, version: p.version, isDev, source: "lockfile" });
  }
  return out;
}

// ── uv.lock ───────────────────────────────────────────────────────────────────

type UvRef = { name?: string; version?: string };
interface UvPackage {
  name?: string;
  version?: string;
  source?: Record<string, unknown>;
  dependencies?: UvRef[];
  "optional-dependencies"?: Record<string, UvRef[]>;
  "dev-dependencies"?: Record<string, UvRef[]>;
}

export function parseUvLock(content: string): Dependency[] {
  const doc = parseToml(content) as { package?: UvPackage[] };
  const pkgs = doc.package ?? [];

  // Several versions of one name can coexist (resolution forks); key by name@version.
  const idsByName = new Map<string, string[]>();
  for (const p of pkgs) {
    if (!p.name) continue;
    const n = normalize(p.name);
    idsByName.set(n, [...(idsByName.get(n) ?? []), `${n}@${p.version ?? ""}`]);
  }
  const refIds = (refs: UvRef[] | undefined): string[] =>
    (refs ?? []).flatMap((r) => {
      if (!r.name) return [];
      const n = normalize(r.name);
      return r.version ? [`${n}@${r.version}`] : (idsByName.get(n) ?? []);
    });

  const nodes = new Map<string, GraphNode>();
  const prodRoots: string[] = [];
  const devRoots: string[] = [];
  const audited = new Set<string>();

  for (const p of pkgs) {
    if (!p.name) continue;
    const id = `${normalize(p.name)}@${p.version ?? ""}`;
    const extras = Object.values(p["optional-dependencies"] ?? {}).flat();
    const deps = refIds([...(p.dependencies ?? []), ...extras]);
    nodes.set(id, { name: p.name, version: p.version ?? "", deps });

    const source = p.source ?? {};
    if ("registry" in source) {
      if (p.version) audited.add(id);
    } else if ("virtual" in source || "editable" in source) {
      // The project itself (or a workspace member): its edges are the roots.
      prodRoots.push(...deps);
      devRoots.push(...refIds(Object.values(p["dev-dependencies"] ?? {}).flat()));
    }
  }

  const dev = devOnly(nodes, prodRoots, devRoots);
  const paths = shortestPaths(nodes, [...prodRoots, ...devRoots]);
  return [...audited].map((id) => {
    const n = nodes.get(id)!;
    const path = pathLabels(nodes, paths.get(id));
    return { name: n.name, version: n.version, isDev: dev.has(id), source: "lockfile" as const, ...(path ? { path } : {}) };
  });
}

// ── Pipfile.lock ──────────────────────────────────────────────────────────────

type PipfileSection = Record<string, { version?: string }>;

export function parsePipfileLock(content: string): Dependency[] {
  const doc = JSON.parse(content) as { default?: PipfileSection; develop?: PipfileSection };
  const out: Dependency[] = [];
  const seen = new Set<string>();
  for (const [section, isDev] of [["default", false], ["develop", true]] as const) {
    for (const [name, info] of Object.entries(doc[section] ?? {})) {
      // Git / editable entries have no version.
      const version = info?.version?.replace(/^==/, "");
      if (!version) continue;
      const key = `${normalize(name)}@${version}`;
      if (seen.has(key)) continue; // a package in both sections is production
      seen.add(key);
      out.push({ name, version, isDev, source: "lockfile" });
    }
  }
  return out;
}
