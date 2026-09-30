import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { auditCatalog, type AuditResult, type Finding } from "./analyzer.js";
import type { ToolRecord } from "./capabilities.js";

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp",
  ".pdf", ".zip", ".tar", ".gz", ".lock",
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", "coverage", "venv", ".venv",
]);
const MAX_FILE_SIZE = 1 * 1024 * 1024;

/**
 * Extract MCP SDK `.tool("name", "description", ...)` registrations from source.
 * Enough to rough-classify a server without a live tools/list.
 */
export function extractToolsFromSource(text: string): ToolRecord[] {
  const tools: ToolRecord[] = [];
  const re = /\.tool\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*["'`]([^"'`]*)["'`])?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tools.push({ name: match[1] ?? "", description: match[2] });
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return tools;
}

export function scanSourceText(text: string, label?: string): AuditResult {
  return auditCatalog(extractToolsFromSource(text), label ?? "source");
}

export function scanSourceFile(filePath: string): { result: AuditResult; skipped: boolean } {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return { result: emptyResult(), skipped: true };
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { result: emptyResult(), skipped: true };
  }
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return { result: emptyResult(), skipped: true };
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { result: emptyResult(), skipped: true };
  }
  return { result: scanSourceText(content, filePath), skipped: false };
}

function emptyResult(): AuditResult {
  return {
    toolCount: 0,
    grade: "A",
    score: 100,
    byCapability: {
      "untrusted-content": [],
      "sensitive-data": [],
      exfiltration: [],
      destructive: [],
    },
    findings: [],
    durationMs: 0,
  };
}

export function scanDirectory(
  dirPath: string,
  options: { maxFiles?: number; exclude?: string[] } = {}
): AuditResult & { scannedFiles: number; skippedFiles: number } {
  const start = Date.now();
  const { maxFiles = 5000, exclude } = options;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error(`maxFiles must be a positive integer (got ${String(maxFiles)})`);
  }

  const allTools: ToolRecord[] = [];
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
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (exclude?.some((ex) => entry.name === ex || fullPath.includes(ex))) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = relative(dirPath, fullPath);
        if (exclude?.some((ex) => rel.includes(ex))) {
          skippedFiles++;
          continue;
        }
        const ext = extname(fullPath).toLowerCase();
        if (SKIP_EXTENSIONS.has(ext)) {
          skippedFiles++;
          continue;
        }
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          skippedFiles++;
          continue;
        }
        if (!stat.isFile() || stat.size > MAX_FILE_SIZE) {
          skippedFiles++;
          continue;
        }
        try {
          const content = readFileSync(fullPath, "utf8");
          const tools = extractToolsFromSource(content);
          scannedFiles++;
          allTools.push(...tools);
        } catch {
          skippedFiles++;
        }
      }
    }
  }

  walk(dirPath);

  const byName = new Map<string, ToolRecord>();
  for (const tool of allTools) {
    if (!tool.name) continue;
    const prev = byName.get(tool.name);
    if (!prev || (tool.description && !(prev.description ?? ""))) byName.set(tool.name, tool);
    else if (!byName.has(tool.name)) byName.set(tool.name, tool);
  }

  const result = auditCatalog([...byName.values()], dirPath);
  return {
    ...result,
    scannedFiles,
    skippedFiles,
    durationMs: Date.now() - start,
  };
}

export type { Finding, AuditResult };
