import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

// ── guardbee.yml schema (prompt-leak-scanner section) ───────────────────────────
//
// prompt-leak-scanner:
//   fail-on: high          # any | critical | high | medium | low | none
//   max-files: 5000
//   exclude:
//     - "fixtures/"

export interface PromptLeakScannerConfig {
  failOn: string;
  maxFiles: number;
  exclude: string[];
}

const DEFAULTS: PromptLeakScannerConfig = {
  failOn: "any",
  maxFiles: 5000,
  exclude: [],
};

function findConfigFile(startDir: string): string | null {
  const names = ["guardbee.yml", "guardbee.yaml", ".guardbee.yml"];
  let dir = resolve(startDir);

  for (let i = 0; i < 5; i++) {
    for (const name of names) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
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
      if (currentKey && currentList) {
        (root[currentSection!] as Record<string, unknown>)[currentKey] = currentList;
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

    if (indent === 4 && currentList !== null) {
      const item = line.trim().replace(/^-\s*/, "").replace(/^['"]|['"]$/g, "");
      currentList.push(item);
      continue;
    }
  }

  if (currentKey && currentList && currentSection) {
    (root[currentSection] as Record<string, unknown>)[currentKey] = currentList;
  }

  return root;
}

export function loadConfig(searchDir: string, cliOverrides: Partial<PromptLeakScannerConfig> = {}): PromptLeakScannerConfig {
  const configPath = findConfigFile(searchDir);
  if (!configPath) return { ...DEFAULTS, ...cliOverrides };

  let fileConfig: Partial<PromptLeakScannerConfig> = {};
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseYaml(raw);
    const section = parsed["prompt-leak-scanner"] as Record<string, unknown> | undefined;
    if (section) {
      if (typeof section["fail-on"] === "string") fileConfig.failOn = section["fail-on"];
      if (typeof section["max-files"] === "string") fileConfig.maxFiles = parseInt(section["max-files"], 10);
      if (Array.isArray(section["exclude"])) fileConfig.exclude = section["exclude"] as string[];
    }
  } catch {
    // ignore parse errors, use defaults
  }

  return { ...DEFAULTS, ...fileConfig, ...cliOverrides };
}

export function configFilePath(searchDir: string): string | null {
  return findConfigFile(searchDir);
}
