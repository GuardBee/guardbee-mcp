import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface DeclaredDependency {
  name: string;
  isDev: boolean;
}

function parseRequirementName(spec: string): string | null {
  const match = spec.match(/^([A-Za-z0-9_.-]+)/);
  return match?.[1] ?? null;
}

function parseRequirementsFile(filePath: string, deps: DeclaredDependency[]): void {
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-r") || line.startsWith("--")) continue;
    const name = parseRequirementName(line);
    if (name) deps.push({ name, isDev: false });
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

function parsePyproject(content: string, deps: DeclaredDependency[]): void {
  // PEP 621: [project] dependencies = [ "name==1.2.3", ... ]
  const project = extractTomlTable(content, "project");
  if (project) {
    const arrayBody = extractAssignedArray(project, "dependencies");
    if (arrayBody) {
      for (const spec of tomlStrings(arrayBody)) {
        const name = parseRequirementName(spec);
        if (name) deps.push({ name, isDev: false });
      }
    }
  }

  // Poetry: [tool.poetry.dependencies] name = "^1.2.3" (table, not array)
  const poetryDeps = extractTomlTable(content, "tool.poetry.dependencies");
  if (poetryDeps) {
    const re = /^([A-Za-z0-9_.-]+)\s*=/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(poetryDeps)) !== null) {
      const name = m[1];
      if (name && name.toLowerCase() !== "python") deps.push({ name, isDev: false });
    }
  }
}

export function parsePipDirectDependencies(dir: string): DeclaredDependency[] {
  const deps: DeclaredDependency[] = [];

  const reqPath = join(dir, "requirements.txt");
  if (existsSync(reqPath)) {
    try {
      parseRequirementsFile(reqPath, deps);
    } catch {
      // ignore
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
