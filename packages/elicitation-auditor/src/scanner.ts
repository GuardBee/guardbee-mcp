import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { checkById, type ElicitationCategory } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: ElicitationCategory;
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
const MAX_CALL_SPAN = 2500;

const CALL_RE = /\.(?:elicitInput|elicit)\s*\(|["']elicitation\/create["']/g;

const SENSITIVE_KEY_RE =
  /(?:["']|[{,\s])(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|card[_-]?number|credit[_-]?card|cvv|cvc|ssn|private[_-]?key|otp)(?![A-Za-z0-9_])["']?\s*:/gi;

const PASSWORD_FORMAT_RE = /format\s*:\s*["']password["']/i;

const URL_LITERAL_RE = /\burl\s*[:=]\s*[fFrR]?["'`](https?:\/\/[^"'`]+)["'`]/g;

const CREDENTIAL_QUERY_RE =
  /(?:^|[?&])(access_token|refresh_token|id_token|api_key|apikey|password|client_secret|token|code)=/i;

const PII_QUERY_RE = /(?:^|[?&])email=|@[a-z0-9.-]+\.[a-z]{2,}/i;

const AUTHORIZE_SEGMENT = new Set(["authorize", "oauth", "oauth2"]);
const AFTER_CALL_WINDOW = 500;

const CLICKABLE_URL_RE = /(?:message|description|title)\s*[:=]\s*["'`][^"'`]{0,240}https?:\/\//i;

const READS_CONTENT_RE = /\.content\b|\[["']content["']\]/;
const CHECKS_ACTION_RE = /\.action\b|\b(?:decline|cancel)\b/;

const IDENTITY_SINK_RE =
  /(?:findUser|getUser|loginAs|authenticate|authorize|setUser|impersonate|loadUser)\s*\([^)\n]{0,120}(?:\.content|\[["']content["']\])\s*(?:\.\s*|\s*\[\s*["'])(?:email|userId|user_id|username)\b|(?:userId|user_id|session\.user|req\.user)\s*=\s*[^;\n]{0,120}(?:\.content|\[["']content["']\])\s*(?:\.\s*|\s*\[\s*["'])(?:email|userId|user_id|username)\b/;

const VERIFIED_SUBJECT_RE = /\bsub\b|authInfo|session\.subject/;

function locationOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const column = index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
  return { line, column };
}

function findMatchingDelimiter(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  const limit = Math.min(text.length, openIndex + MAX_CALL_SPAN);
  for (let i = openIndex; i < limit; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return limit;
}

function spanFrom(text: string, matchIndex: number, matchLen: number): string {
  const head = text.slice(matchIndex, matchIndex + matchLen);
  if (head.endsWith("(")) {
    const open = matchIndex + matchLen - 1;
    return text.slice(matchIndex, findMatchingDelimiter(text, open, "(", ")"));
  }
  const windowEnd = Math.min(text.length, matchIndex + MAX_CALL_SPAN);
  const window = text.slice(matchIndex, windowEnd);
  const brace = window.indexOf("{");
  if (brace === -1) return window;
  const abs = matchIndex + brace;
  return text.slice(matchIndex, findMatchingDelimiter(text, abs, "{", "}"));
}

function modeOf(span: string): "url" | "form" {
  if (/\bmode\s*[:=]\s*["']url["']/.test(span)) return "url";
  return "form";
}

function pushFinding(
  findings: Finding[],
  id: string,
  text: string,
  index: number,
  match: string,
  filePath?: string
): void {
  const check = checkById(id);
  const { line, column } = locationOf(text, index);
  findings.push({
    patternId: check.id,
    patternName: check.name,
    category: check.category,
    severity: check.severity,
    recommendation: check.recommendation,
    file: filePath,
    line,
    column,
    match: match.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
    context: "",
  });
}

function parseHttpUrl(raw: string): URL | null {
  const cleaned = raw.replace(/\$\{[^}]*\}/g, "x").replace(/\{[^}]*\}/g, "x");
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isDirectAuthorize(url: URL): boolean {
  const parts = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (parts.includes("connect")) return false;
  return parts.some((part) => AUTHORIZE_SEGMENT.has(part));
}

function checkFormSecrets(span: string, text: string, spanIndex: number, filePath: string | undefined, findings: Finding[]): void {
  if (modeOf(span) === "url") return;

  const seen = new Set<string>();
  const keyRe = new RegExp(SENSITIVE_KEY_RE.source, SENSITIVE_KEY_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(span)) !== null) {
    const key = match[1]?.toLowerCase() ?? "secret";
    if (seen.has(key)) continue;
    seen.add(key);
    pushFinding(findings, "form_mode_secret", text, spanIndex + match.index, match[0], filePath);
    if (match.index === keyRe.lastIndex) keyRe.lastIndex++;
  }

  const formatMatch = PASSWORD_FORMAT_RE.exec(span);
  if (formatMatch && !seen.has("password")) {
    pushFinding(findings, "form_mode_secret", text, spanIndex + formatMatch.index, formatMatch[0], filePath);
  }

  const link = CLICKABLE_URL_RE.exec(span);
  if (link) {
    pushFinding(findings, "form_clickable_url", text, spanIndex + link.index, link[0], filePath);
  }
}

function afterCall(text: string, spanEnd: number): string {
  return text.slice(spanEnd, Math.min(text.length, spanEnd + AFTER_CALL_WINDOW));
}

function checkAfterCall(
  span: string,
  text: string,
  spanIndex: number,
  filePath: string | undefined,
  findings: Finding[]
): void {
  const after = afterCall(text, spanIndex + span.length);
  const readsContent = READS_CONTENT_RE.test(after);
  if (readsContent && !CHECKS_ACTION_RE.test(after)) {
    pushFinding(findings, "ignored_decline", text, spanIndex, span.slice(0, 80), filePath);
  }

  const sink = new RegExp(IDENTITY_SINK_RE.source, IDENTITY_SINK_RE.flags).exec(after);
  if (modeOf(span) === "form" && sink && !VERIFIED_SUBJECT_RE.test(after)) {
    pushFinding(
      findings,
      "client_asserted_identity",
      text,
      spanIndex + span.length + sink.index,
      sink[0],
      filePath
    );
  }
}

function checkUrl(span: string, text: string, spanIndex: number, filePath: string | undefined, findings: Finding[]): void {
  if (modeOf(span) !== "url") return;

  const urlRe = new RegExp(URL_LITERAL_RE.source, URL_LITERAL_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(span)) !== null) {
    const raw = match[1] ?? "";
    const url = parseHttpUrl(raw);
    const at = spanIndex + match.index;
    if (!url) {
      if (match.index === urlRe.lastIndex) urlRe.lastIndex++;
      continue;
    }

    if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
      pushFinding(findings, "elicitation_url_not_https", text, at, match[0], filePath);
    }
    if (CREDENTIAL_QUERY_RE.test(url.search)) {
      pushFinding(findings, "url_embeds_credential", text, at, match[0], filePath);
    }
    if (PII_QUERY_RE.test(`${url.search}${url.pathname}`)) {
      pushFinding(findings, "url_embeds_pii", text, at, match[0], filePath);
    }
    if (isDirectAuthorize(url)) {
      pushFinding(findings, "url_third_party_authorize", text, at, match[0], filePath);
    }
    if (match.index === urlRe.lastIndex) urlRe.lastIndex++;
  }
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const callRe = new RegExp(CALL_RE.source, CALL_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(text)) !== null) {
    const span = spanFrom(text, match.index, match[0].length);
    checkFormSecrets(span, text, match.index, filePath, findings);
    checkUrl(span, text, match.index, filePath, findings);
    checkAfterCall(span, text, match.index, filePath, findings);
    if (match.index === callRe.lastIndex) callRe.lastIndex++;
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
