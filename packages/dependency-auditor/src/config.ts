import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

// ── guardbee.yml schema (dependency-auditor section) ──────────────────────────
//
// dependency-auditor:
//   fail-on: high          # critical | high | medium | low | none
//   fail-on-kev: false     # fail on any finding in the CISA KEV catalog
//   fail-on-epss: 0.5      # fail on any finding with EPSS ≥ this (0–1)
//   exploit-data: true     # fetch CISA KEV / FIRST EPSS (sends CVE IDs only)
//   include-dev: false
//   ignore:                # CVE / GHSA IDs to ignore
//     - "GHSA-xxxx-xxxx-xxxx"
//     - "CVE-2023-12345"

export interface DependencyAuditorConfig {
  failOn: string;
  failOnKev: boolean;
  /** EPSS threshold in [0, 1], or null for no EPSS gate. */
  failOnEpss: number | null;
  exploitData: boolean;
  includeDev: boolean;
  ignore: string[];
}

const DEFAULTS: DependencyAuditorConfig = {
  failOn: "high",
  failOnKev: false,
  failOnEpss: null,
  exploitData: true,
  includeDev: false,
  ignore: [],
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
      if (currentKey && currentList && currentSection) {
        (root[currentSection] as Record<string, unknown>)[currentKey] = currentList;
        currentList = null; currentKey = null;
      }
      currentSection = line.trim().slice(0, -1);
      root[currentSection] = {};
      continue;
    }

    if (indent === 2 && currentSection) {
      if (currentKey && currentList) {
        (root[currentSection] as Record<string, unknown>)[currentKey] = currentList;
        currentList = null; currentKey = null;
      }
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (value === "") { currentKey = key; currentList = []; }
      else (root[currentSection] as Record<string, unknown>)[key] = value;
      continue;
    }

    if (indent === 4 && currentList !== null) {
      currentList.push(line.trim().replace(/^-\s*/, "").replace(/^['"]|['"]$/g, ""));
      continue;
    }
  }

  if (currentKey && currentList && currentSection) {
    (root[currentSection] as Record<string, unknown>)[currentKey] = currentList;
  }
  return root;
}

export function loadConfig(searchDir: string | null, cliOverrides: Partial<DependencyAuditorConfig> = {}): DependencyAuditorConfig {
  const configPath = searchDir ? findConfigFile(searchDir) : null;

  let fileConfig: Partial<DependencyAuditorConfig> = {};
  if (configPath) try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseYaml(raw);
    const section = parsed["dependency-auditor"] as Record<string, unknown> | undefined;
    if (section) {
      if (typeof section["fail-on"] === "string") fileConfig.failOn = section["fail-on"];
      if (typeof section["include-dev"] === "string") fileConfig.includeDev = section["include-dev"] === "true";
      if (typeof section["fail-on-kev"] === "string") fileConfig.failOnKev = section["fail-on-kev"] === "true";
      if (typeof section["fail-on-epss"] === "string") fileConfig.failOnEpss = Number(section["fail-on-epss"]);
      if (typeof section["exploit-data"] === "string") fileConfig.exploitData = section["exploit-data"] !== "false";
      if (Array.isArray(section["ignore"])) fileConfig.ignore = section["ignore"] as string[];
    }
  } catch { /* ignore */ }

  const cfg = { ...DEFAULTS, ...fileConfig, ...cliOverrides };
  if (cfg.failOnEpss !== null && !(cfg.failOnEpss >= 0 && cfg.failOnEpss <= 1)) {
    throw new Error(`fail-on-epss must be a number between 0 and 1, got ${cfg.failOnEpss}`);
  }
  if (!["critical", "high", "medium", "low", "none"].includes(cfg.failOn)) {
    throw new Error(`fail-on must be critical, high, medium, low or none, got "${cfg.failOn}"`);
  }
  return cfg;
}

export function configFilePath(searchDir: string): string | null {
  return findConfigFile(searchDir);
}
