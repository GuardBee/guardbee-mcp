import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Dependency } from "./npm.js";

/**
 * Version sent to OSV. Prefer an exact pin (`==`). Otherwise use the lower
 * bound (`>=`, `~=`, `>`). Do not concatenate a range like `>=4.2,<5` into
 * `4.25`, and do not treat an upper bound alone as an installed version.
 */
function versionForQuery(spec: string): string {
  const pinned = spec.match(/==\s*([0-9][0-9A-Za-z.*+]*)/);
  if (pinned?.[1]) return pinned[1];
  const lower = spec.match(/(?:>=|~=|>)\s*([0-9]+(?:\.[0-9A-Za-z]+)*)/);
  return lower?.[1] ?? "";
}

function parseRequirement(spec: string): Dependency | null {
  const match = spec.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(.*)$/);
  if (!match) return null;
  const name = match[1];
  const versionSpec = (match[2] ?? "").split(";")[0] ?? "";
  const version = versionForQuery(versionSpec);
  if (!name || !version) return null;
  return { name, version, isDev: false, source: "direct" };
}

function parseRequirementsFile(filePath: string, deps: Dependency[]): void {
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-r") || line.startsWith("--")) continue;
    const dep = parseRequirement(line);
    if (dep) deps.push(dep);
  }
}

/** Body of a top-level TOML table such as `[project]`, stopping at the next header. */
function extractTomlTable(content: string, table: string): string | null {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\[${escaped}\\]\\s*$`, "m");
  const m = re.exec(content);
  if (!m) return null;
  const rest = content.slice(m.index + m[0].length);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Value of `key = [ ... ]`, respecting nested brackets inside quoted strings. */
function extractAssignedArray(section: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*=\\s*\\[`, "m");
  const m = re.exec(section);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let quote: '"' | "'" | null = null;
  const start = i;
  while (i < section.length && depth > 0) {
    const c = section[i];
    if (quote) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return section.slice(start, i - 1);
}

function tomlStrings(body: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push(m[1] ?? m[2] ?? "");
  }
  return out;
}

function parsePyproject(content: string, deps: Dependency[]): void {
  // PEP 621: [project] dependencies = [ "name==1.2.3", ... ]
  const project = extractTomlTable(content, "project");
  if (!project) return;
  const arrayBody = extractAssignedArray(project, "dependencies");
  if (!arrayBody) return;
  for (const spec of tomlStrings(arrayBody)) {
    const dep = parseRequirement(spec);
    if (dep) deps.push(dep);
  }
}

export function parsePipRequirements(dir: string): Dependency[] {
  const candidates = [
    "requirements.txt",
    "requirements/base.txt",
    "requirements/prod.txt",
    "requirements/production.txt",
  ];

  const deps: Dependency[] = [];

  for (const candidate of candidates) {
    const filePath = join(dir, candidate);
    if (!existsSync(filePath)) continue;
    try {
      parseRequirementsFile(filePath, deps);
    } catch {
      continue;
    }
  }

  const pyprojectPath = join(dir, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      parsePyproject(readFileSync(pyprojectPath, "utf8"), deps);
    } catch {
      // ignore
    }
  }

  return deps;
}
