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

// Yaygın suppression annotasyonları: detect-secrets, gitleaks, trufflehog ve
// genel nosec/nosemgrep konvansiyonları. Aynı satırda bulunursa finding'i bastırır.
const SUPPRESSION_MARKERS =
  /(?:pragma:\s*allowlist[\s-]secret|gitleaks:\s*allow|trufflehog:\s*ignore|nosec\b|nosemgrep\b|guardbee:\s*allow|guardbee-ignore)/i;

function isSuppressed(contextLine: string): boolean {
  return SUPPRESSION_MARKERS.test(contextLine);
}

// Dokümantasyon/örnek koddaki tipik doldurucu değerler gerçek secret'larda
// pratik olarak hiç görülmeyen üç şekilden birini alır: aynı karakterin
// tekrarı, alfabe/rakamda ardışık bir dizi, ya da değerin içine gömülü bir
// "example/placeholder" kelimesi (örn. AWS'in kendi resmi örnek anahtarı
// AKIAIOSFODNN7EXAMPLE). Gerçek rastgele bir secret'ta bunlardan biri şans
// eseri oluşma olasılığı ihmal edilebilir düzeyde düşük.
const PLACEHOLDER_WORDS =
  /example|placeholder|sample|dummy|fakekey|fake[_-]?key|change[-_]?me|testkey|yourkey|redacted/i;

function hasLongSequentialRun(value: string, minLen = 8): boolean {
  let run = 1;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) === value.charCodeAt(i - 1) + 1) {
      run++;
      if (run >= minLen) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

function isPlaceholderValue(matchStr: string): boolean {
  if (/(.)\1{7,}/.test(matchStr)) return true; // 8+ tekrar eden aynı karakter
  if (hasLongSequentialRun(matchStr)) return true; // 8+ ardışık kod noktası
  if (PLACEHOLDER_WORDS.test(matchStr)) return true;
  return false;
}

// JS/TS (__tests__, .test., .spec.) ve Python (tests/, test_*.py, *_test.py)
// konvansiyonlarını kapsar — bu dogfooding turunda karşılaşılan gerçek repo
// yapısına göre kalibre edildi.
const TEST_PATH_RE =
  /(?:^|[\\/])(?:__tests__|tests?)(?:[\\/]|$)|\.(?:test|spec)\.[jt]sx?$|(?:^|[\\/])test_[^\\/]+\.py$|_test\.py$/i;

function isTestFilePath(filePath: string | undefined): boolean {
  return !!filePath && TEST_PATH_RE.test(filePath);
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
      if (!sp.skipPlaceholderCheck && isPlaceholderValue(matchStr)) continue;

      // Find line/column
      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const lastNl = before.lastIndexOf("\n");
      const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;

      const contextLine = lines[line - 1] ?? "";
      if (isSuppressed(contextLine)) continue;

      const redactedContext = contextLine.replace(matchStr, redact(matchStr));

      const severity =
        sp.lowerSeverityInTestFiles && isTestFilePath(filePath) ? "low" : sp.severity;

      findings.push({
        patternId: sp.id,
        patternName: sp.name,
        severity,
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
