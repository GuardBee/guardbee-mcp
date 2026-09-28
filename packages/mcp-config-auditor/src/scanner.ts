import { readFileSync, readdirSync, statSync } from "fs";
import { basename, join, relative } from "path";
import { parseMcpConfig } from "./parseConfig.js";
import { auditServers, findToolShadowing } from "./rules.js";
import { auditSkill, findSkillShadowing, parseSkillMarkdown, skillNameFromPath, type NamedSkill } from "./skills.js";
import type { ConfigFinding, InventoryServer } from "./types.js";

const CONFIG_NAMES = new Set(["mcp.json", "mcp_config.json", "claude_desktop_config.json"]);
const SKILL_FILE = "SKILL.md";
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const MAX_FILE_SIZE = 1024 * 1024;

export interface ScanResult {
  scannedFiles: number;
  skippedFiles: number;
  findings: ConfigFinding[];
  durationMs: number;
}

export function scanConfigText(text: string, file?: string): ConfigFinding[] {
  const parsed = parseMcpConfig(text);
  if (parsed.error) {
    return [
      {
        patternId: "config_unreadable",
        patternName: "MCP client config could not be parsed",
        category: "config",
        severity: "medium",
        owasp: "MCP09:2025",
        recommendation: "Fix the JSON so the server list can be audited. A config that does not parse still gets loaded by some clients after a partial edit.",
        file,
        line: 1,
        column: 1,
        match: parsed.error.slice(0, 200),
      },
    ];
  }
  return auditServers(parsed.servers, text, file);
}

export function scanSkillText(text: string, file?: string, fallbackName?: string): ConfigFinding[] {
  const name = fallbackName ?? (file ? skillNameFromPath(file) : "skill");
  return auditSkill(text, file, name);
}

function loadTextFile(filePath: string): { content: string } | { skipped: true } {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { skipped: true };
  }
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return { skipped: true };
  try {
    return { content: readFileSync(filePath, "utf8") };
  } catch {
    return { skipped: true };
  }
}

function findingsForFile(filePath: string, content: string): ConfigFinding[] {
  if (basename(filePath) === SKILL_FILE) return scanSkillText(content, filePath);
  return scanConfigText(content, filePath);
}

export function scanConfigFile(filePath: string): { findings: ConfigFinding[]; skipped: boolean } {
  const loaded = loadTextFile(filePath);
  if ("skipped" in loaded) return { findings: [], skipped: true };
  return { findings: findingsForFile(filePath, loaded.content), skipped: false };
}

export function scanDirectory(
  dirPath: string,
  options: { maxFiles?: number; exclude?: string[] } = {}
): ScanResult {
  const start = Date.now();
  const { maxFiles = 5000, exclude } = options;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error(`maxFiles must be a positive integer (got ${String(maxFiles)})`);
  }
  const findings: ConfigFinding[] = [];
  const skills: NamedSkill[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  function walk(dir: string) {
    if (scannedFiles + skippedFiles >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scannedFiles + skippedFiles >= maxFiles) return;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (exclude?.some((item) => entry.name === item || fullPath.includes(item))) continue;
        walk(fullPath);
        continue;
      }
      if (!CONFIG_NAMES.has(entry.name) && entry.name !== SKILL_FILE) {
        skippedFiles++;
        continue;
      }
      const rel = relative(dirPath, fullPath);
      if (exclude?.some((item) => rel.includes(item))) {
        skippedFiles++;
        continue;
      }
      const loaded = loadTextFile(fullPath);
      if ("skipped" in loaded) {
        skippedFiles++;
        continue;
      }
      scannedFiles++;
      findings.push(...findingsForFile(fullPath, loaded.content));
      if (entry.name === SKILL_FILE) {
        const parsed = parseSkillMarkdown(loaded.content, skillNameFromPath(fullPath));
        skills.push({ name: parsed.name, file: fullPath });
      }
    }
  }

  walk(dirPath);
  findings.push(...findSkillShadowing(skills));
  return { scannedFiles, skippedFiles, findings, durationMs: Date.now() - start };
}

export function scanInventory(servers: InventoryServer[], file?: string): ConfigFinding[] {
  return findToolShadowing(servers, file);
}
