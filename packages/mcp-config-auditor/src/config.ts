import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

export interface ConfigAuditorConfig {
  failOn: string;
  maxFiles: number;
  exclude: string[];
}

const DEFAULTS: ConfigAuditorConfig = {
  failOn: "any",
  maxFiles: 5000,
  exclude: [],
};

function findConfigFile(startDir: string): string | null {
  const names = ["guardbee.yml", "guardbee.yaml", ".guardbee.yml"];
  let dir = resolve(startDir);
  for (let i = 0; i < 5; i++) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseYaml(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let currentSection: string | null = null;
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;

    if (indent === 0 && line.trim().endsWith(":")) {
      if (currentKey && currentList && currentSection) {
        (root[currentSection] as Record<string, unknown>)[currentKey] = currentList;
        currentList = null;
        currentKey = null;
      }
      currentSection = line.trim().slice(0, -1);
      root[currentSection] = {};
      continue;
    }

    if (indent === 2 && currentSection) {
      if (currentKey && currentList) {
        (root[currentSection] as Record<string, unknown>)[currentKey] = currentList;
        currentList = null;
        currentKey = null;
      }
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (value === "") {
        currentKey = key;
        currentList = [];
      } else {
        (root[currentSection] as Record<string, unknown>)[key] = value;
      }
      continue;
    }

    if (indent === 4 && currentList) {
      currentList.push(line.trim().replace(/^-\s*/, "").replace(/^['"]|['"]$/g, ""));
    }
  }

  if (currentKey && currentList && currentSection) {
    (root[currentSection] as Record<string, unknown>)[currentKey] = currentList;
  }
  return root;
}

export function loadConfig(searchDir: string, cliOverrides: Partial<ConfigAuditorConfig> = {}): ConfigAuditorConfig {
  const configPath = findConfigFile(searchDir);
  if (!configPath) return { ...DEFAULTS, ...cliOverrides };
  let fileConfig: Partial<ConfigAuditorConfig> = {};
  try {
    const parsed = parseYaml(readFileSync(configPath, "utf8"));
    const section = parsed["mcp-config-auditor"] as Record<string, unknown> | undefined;
    if (section) {
      if (typeof section["fail-on"] === "string") fileConfig.failOn = section["fail-on"];
      if (typeof section["max-files"] === "string") fileConfig.maxFiles = parseInt(section["max-files"], 10);
      if (Array.isArray(section.exclude)) fileConfig.exclude = section.exclude as string[];
    }
  } catch {
    fileConfig = {};
  }
  return { ...DEFAULTS, ...fileConfig, ...cliOverrides };
}

export function configFilePath(searchDir: string): string | null {
  return findConfigFile(searchDir);
}
