import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { ANALYSIS_DEPTH, extractSourceTools, languageOf } from "@guardbee/guard-core";
import { extractToolBlocks } from "@guardbee/mcp-tool-poisoning-scanner";
import type { FileCoverage, LanguageCoverage, ScanCoverage } from "./types.js";

/**
 * Which source files a path scan understood, and how deeply: TypeScript,
 * JavaScript, Python and Go get tool definitions, handler sinks and OAuth
 * rules ("full"); other languages only the language-neutral patterns
 * (secrets, URLs, config). Files that are not code (docs, JSON, YAML) are
 * scanned by the same rules but not listed.
 */

// The scanners' own skip lists
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "dist", "build", ".next", "__pycache__", ".mypy_cache", ".pytest_cache", "venv", ".venv", "coverage", ".nyc_output"]);
const MAX_FILE_SIZE = 1024 * 1024;

function toolCount(path: string): number {
  const language = languageOf(path);
  if (!language || ANALYSIS_DEPTH[language] !== "full") return 0;
  let text: string;
  try {
    if (statSync(path).size > MAX_FILE_SIZE) return 0;
    text = readFileSync(path, "utf8");
  } catch {
    return 0;
  }
  return language === "python" || language === "go" ? extractSourceTools(text, language).length : extractToolBlocks(text).length;
}

export function fileCoverage(path: string, label = path): FileCoverage | undefined {
  const language = languageOf(path);
  if (!language) return undefined;
  return { file: label, language, analysis: ANALYSIS_DEPTH[language], tools: toolCount(path) };
}

export function summarize(files: FileCoverage[]): ScanCoverage {
  const byLanguage = new Map<string, LanguageCoverage>();
  for (const file of files) {
    const entry = byLanguage.get(file.language) ?? { language: file.language, analysis: file.analysis, files: 0, tools: 0 };
    entry.files++;
    entry.tools += file.tools;
    byLanguage.set(file.language, entry);
  }
  return { languages: [...byLanguage.values()].sort((a, b) => b.files - a.files || a.language.localeCompare(b.language)), files };
}

export function directoryCoverage(root: string, options: { maxFiles?: number; exclude?: string[] } = {}): ScanCoverage {
  const maxFiles = options.maxFiles ?? 5000;
  const files: FileCoverage[] = [];
  let seen = 0;
  const walk = (dir: string) => {
    if (seen >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= maxFiles) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (options.exclude?.some((ex) => entry.name === ex || full.includes(ex))) continue;
        walk(full);
      } else if (entry.isFile()) {
        const rel = relative(root, full);
        if (options.exclude?.some((ex) => rel.includes(ex))) continue;
        seen++;
        const coverage = fileCoverage(full, rel);
        if (coverage) files.push(coverage);
      }
    }
  };
  walk(root);
  return summarize(files.sort((a, b) => a.file.localeCompare(b.file)));
}
