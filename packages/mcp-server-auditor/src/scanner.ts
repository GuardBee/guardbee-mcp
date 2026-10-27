import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { languageOf, type SourceLanguage } from "@guardbee/guard-core";
import { checkToolInputFlows } from "./languages.js";
import { MCP_AUDITOR_PATTERNS, type McpAuditPattern } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: McpAuditPattern["category"];
  severity: McpAuditPattern["severity"];
  owasp?: string;
  recommendation: string;
  /** Source language of the file, when it is code. */
  language?: SourceLanguage;
  file?: string;
  line: number;
  column: number;
  /** Eşleşen kod parçası — bir secret değil bir kalıp olduğu için redakte edilmez. */
  match: string;
  context: string;
}

export interface ScanResult {
  scannedFiles: number;
  skippedFiles: number;
  totalFindings: number;
  findings: Finding[];
  durationMs: number;
}

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".mp3", ".mp4", ".avi", ".mov", ".wav",
  ".ttf", ".woff", ".woff2", ".eot",
  ".lock",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", ".next",
  "__pycache__", ".mypy_cache", ".pytest_cache", "venv", ".venv",
  "coverage", ".nyc_output",
]);

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
const MAX_CONTEXT_LENGTH = 240;

/**
 * Scans MCP server source. Python and Go files (by `filePath`'s extension,
 * or `language`) also get the tool-input flow check of languages.ts on top
 * of the regex patterns.
 */
export function scanText(text: string, filePath?: string, language: SourceLanguage | undefined = filePath ? languageOf(filePath) : undefined): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  const located = (index: number) => {
    const before = text.slice(0, index);
    const line = before.split("\n").length;
    const lastNl = before.lastIndexOf("\n");
    return { line, column: index - (lastNl === -1 ? 0 : lastNl + 1) + 1, context: (lines[line - 1] ?? "").trim().slice(0, MAX_CONTEXT_LENGTH) };
  };

  for (const p of MCP_AUDITOR_PATTERNS) {
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matchStr = m[0];

      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const lastNl = before.lastIndexOf("\n");
      const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;

      const contextLine = lines[line - 1] ?? "";

      findings.push({
        patternId: p.id,
        patternName: p.name,
        category: p.category,
        severity: p.severity,
        owasp: p.owasp,
        recommendation: p.recommendation,
        ...(language ? { language } : {}),
        file: filePath,
        line,
        column,
        match: matchStr.trim().slice(0, MAX_CONTEXT_LENGTH),
        context: contextLine.trim().slice(0, MAX_CONTEXT_LENGTH),
      });

      // Sıfır genişlikli eşleşmelerde sonsuz döngüyü önle
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  if (language === "python" || language === "go") {
    // A flow the regex patterns already reported on the same line is not reported twice
    const seen = new Set(findings.map((f) => `${f.patternId}:${f.line}`));
    for (const flow of checkToolInputFlows(text, language)) {
      const { line, column, context } = located(flow.index);
      if (seen.has(`${flow.patternId}:${line}`)) continue;
      seen.add(`${flow.patternId}:${line}`);
      findings.push({
        patternId: flow.patternId,
        patternName: flow.patternName,
        category: flow.category,
        severity: flow.severity,
        owasp: flow.owasp,
        recommendation: flow.recommendation,
        language,
        file: filePath,
        line,
        column,
        match: flow.match.slice(0, MAX_CONTEXT_LENGTH),
        context,
      });
    }
  }

  return findings;
}

export function scanFile(filePath: string): { findings: Finding[]; skipped: boolean } {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return { findings: [], skipped: true };

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { findings: [], skipped: true };
  }

  if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return { findings: [], skipped: true };

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { findings: [], skipped: true };
  }

  return { findings: scanText(content, filePath), skipped: false };
}

export function scanDirectory(
  dirPath: string,
  options: { maxFiles?: number; include?: string[]; exclude?: string[] } = {}
): ScanResult {
  const start = Date.now();
  const { maxFiles = 5000, include, exclude } = options;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error(`maxFiles must be a positive integer (got ${String(maxFiles)})`);
  }
  const allFindings: Finding[] = [];
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
        const relPath = relative(dirPath, fullPath);
        if (exclude?.some((ex) => relPath.includes(ex))) {
          skippedFiles++;
          continue;
        }
        if (include && !include.some((inc) => relPath.includes(inc))) {
          skippedFiles++;
          continue;
        }

        const { findings, skipped } = scanFile(fullPath);
        if (skipped) {
          skippedFiles++;
        } else {
          scannedFiles++;
          allFindings.push(...findings);
        }
      }
    }
  }

  walk(dirPath);

  return {
    scannedFiles,
    skippedFiles,
    totalFindings: allFindings.length,
    findings: allFindings,
    durationMs: Date.now() - start,
  };
}
