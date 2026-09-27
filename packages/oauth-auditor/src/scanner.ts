import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { OAUTH_AUDIT_PATTERNS, type OAuthAuditCategory } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: OAuthAuditCategory;
  severity: "critical" | "high" | "medium";
  recommendation: string;
  file?: string;
  line: number;
  column: number;
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
const MAX_FILE_SIZE = 1 * 1024 * 1024;
const MAX_CONTEXT_LENGTH = 240;
const MAX_CALL_SPAN = 2000;

function locationOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const column = index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
  return { line, column };
}

/** Walks forward from an opening '(' counting depth to find its matching close — string-unaware, a bounded heuristic like the rest of this family. */
function findMatchingParenEnd(text: string, openIndex: number): number {
  let depth = 0;
  const limit = Math.min(text.length, openIndex + MAX_CALL_SPAN);
  for (let i = openIndex; i < limit; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return limit;
}

/**
 * jwt.verify(token, secret [, options]) with no `audience` option means the
 * token's `aud` claim is never checked against this server's own identifier
 * — the MCP spec's named confused-deputy failure: a token issued for a
 * *different* resource server gets accepted here anyway.
 */
function checkMissingAudienceValidation(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /\bjwt\.verify\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const openParenIndex = m.index + m[0].length - 1;
    const callEnd = findMatchingParenEnd(text, openParenIndex);
    const callSpan = text.slice(m.index, callEnd);
    if (!/\baudience\s*:/i.test(callSpan)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "missing_audience_validation",
        patternName: "jwt.verify() call has no audience check",
        category: "token-validation",
        severity: "high",
        recommendation: "Without an `audience` option, jwt.verify() confirms the token is validly signed but never checks who it was issued *for*. A token minted for a completely different resource server will pass verification here just as well — pass { audience: <this server's own resource identifier> } explicitly.",
        file: filePath,
        line,
        column,
        match: callSpan.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
        context: "",
      });
    }
    re.lastIndex = m.index + 1;
  }
  return findings;
}

/**
 * An authorization request built with response_type=code but no
 * code_challenge nearby means PKCE isn't being used — required by OAuth 2.1
 * for every client type, not just public ones.
 */
function checkMissingPkce(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /response_type\s*=\s*code\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const windowStart = Math.max(0, m.index - 200);
    const windowEnd = Math.min(text.length, m.index + 400);
    const window = text.slice(windowStart, windowEnd);
    if (!/code_challenge/i.test(window)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "missing_pkce_on_auth_request",
        patternName: "Authorization request (response_type=code) built with no code_challenge nearby",
        category: "pkce",
        severity: "high",
        recommendation: "OAuth 2.1 requires PKCE (code_challenge/code_verifier) for every authorization_code flow, regardless of client type. Without it, an intercepted authorization code can be redeemed by whoever captured it.",
        file: filePath,
        line,
        column,
        match: text.slice(Math.max(0, m.index - 40), m.index + 40).trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
        context: "",
      });
    }
  }
  return findings;
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];

  for (const p of OAUTH_AUDIT_PATTERNS) {
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matchStr = m[0];
      const { line, column } = locationOf(text, m.index);

      findings.push({
        patternId: p.id,
        patternName: p.name,
        category: p.category,
        severity: p.severity,
        recommendation: p.recommendation,
        file: filePath,
        line,
        column,
        match: matchStr.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
        context: "",
      });

      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  findings.push(...checkMissingAudienceValidation(text, filePath));
  findings.push(...checkMissingPkce(text, filePath));

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
        if (skipped) skippedFiles++;
        else {
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
