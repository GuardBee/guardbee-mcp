import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

// ── guardbee.yml schema (vector-store-scanner section) ─────────────────────────
//
// vector-store-scanner:
//   fail-on: high          # any | critical | high | medium | low | none
//   timeout-ms: 4000

export interface VectorStoreScannerConfig {
  failOn: string;
  timeoutMs: number;
}

const DEFAULTS: VectorStoreScannerConfig = {
  failOn: "any",
  timeoutMs: 4000,
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

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/#.*$/, "");
    if (!line.trim()) continue;

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;

    if (indent === 0 && line.trim().endsWith(":")) {
      currentSection = line.trim().slice(0, -1);
      root[currentSection] = {};
      continue;
    }

    if (indent === 2 && currentSection) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      (root[currentSection] as Record<string, unknown>)[key] = value;
    }
  }

  return root;
}

export function loadConfig(searchDir: string, cliOverrides: Partial<VectorStoreScannerConfig> = {}): VectorStoreScannerConfig {
  const configPath = findConfigFile(searchDir);
  if (!configPath) return { ...DEFAULTS, ...cliOverrides };

  let fileConfig: Partial<VectorStoreScannerConfig> = {};
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseYaml(raw);
    const section = parsed["vector-store-scanner"] as Record<string, unknown> | undefined;
    if (section) {
      if (typeof section["fail-on"] === "string") fileConfig.failOn = section["fail-on"];
      if (typeof section["timeout-ms"] === "string") fileConfig.timeoutMs = parseInt(section["timeout-ms"], 10);
    }
  } catch {
    // ignore parse errors, use defaults
  }

  return { ...DEFAULTS, ...fileConfig, ...cliOverrides };
}

export function configFilePath(searchDir: string): string | null {
  return findConfigFile(searchDir);
}
