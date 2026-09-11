import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { SECRET_PATTERNS, type SecretPattern } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  severity: SecretPattern["severity"];
  file?: string;
  line: number;
  column: number;
  match: string; // redacted
  context: string; // surrounding line, redacted
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
  ".lock", // package-lock, yarn.lock — too noisy
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", ".next",
  "__pycache__", ".mypy_cache", ".pytest_cache", "venv", ".venv",
  "coverage", ".nyc_output",
]);

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

function redact(match: string): string {
  if (match.length <= 8) return "***";
  return match.slice(0, 4) + "*".repeat(Math.min(match.length - 8, 20)) + match.slice(-4);
}

function isAllowlisted(match: string, pattern: SecretPattern): boolean {
  if (!pattern.allowlist) return false;
  return pattern.allowlist.some((allow) => allow.test(match));
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");

  for (const sp of SECRET_PATTERNS) {
    const re = new RegExp(sp.pattern.source, sp.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matchStr = m[0];
      if (isAllowlisted(matchStr, sp)) continue;

      // Find line/column
      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const lastNl = before.lastIndexOf("\n");
      const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;

      const contextLine = lines[line - 1] ?? "";
      const redactedContext = contextLine.replace(matchStr, redact(matchStr));

      findings.push({
        patternId: sp.id,
        patternName: sp.name,
        severity: sp.severity,
        file: filePath,
        line,
        column,
        match: redact(matchStr),
        context: redactedContext.trim().slice(0, 200),
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
