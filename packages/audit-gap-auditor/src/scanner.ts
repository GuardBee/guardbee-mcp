import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { checkById, type AuditGapCategory } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: AuditGapCategory;
  severity: "critical" | "high" | "medium";
  owasp: "MCP08:2025";
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

const MCP_SERVER_RE =
  /\b(?:McpServer|Server)\s*\(|\bFastMCP\s*\(|\bmcp\.server\b|\bfrom\s+mcp\.server\b/i;
const TOOL_REGISTER_RE =
  /\.tool\s*\(|\bCallToolRequest\b|\btools\/call\b|\b@mcp\.tool\b|\b@server\.tool\b/i;

const AUDIT_PRESENCE_RE =
  /\b(?:audit|telemetry|AuditLogger|auditLog|audit_log|logTool|log_tool|recordTool|toolCallLog|instrumentServer)\b/i;

const RAW_ARGS_LOG_RE =
  /\b(?:console\.(?:log|debug|info|warn)|logger\.(?:log|debug|info|warn|error)|log\.(?:debug|info|warn|error)|logging\.(?:debug|info|warning|error))\s*\(\s*(?:JSON\.stringify\s*\(\s*)?(?:args|params|input|arguments|toolArgs|tool_args)\b/gi;

const RAW_RESULT_LOG_RE =
  /\b(?:console\.(?:log|debug|info|warn)|logger\.(?:log|debug|info|warn|error)|log\.(?:debug|info|warn|error)|logging\.(?:debug|info|warning|error))\s*\(\s*(?:JSON\.stringify\s*\(\s*)?(?:result|toolResult|tool_result)\b/gi;

const AUDIT_DISABLED_RE =
  /\b(?:audit|enableAudit|enable_audit|telemetry)\s*[:=]\s*(?:false|0|False)\b|\b(?:GUARDBEE_TELEMETRY|AUDIT_ENABLED|ENABLE_AUDIT)\s*=\s*["']?0["']?/g;

const SILENT_CATCH_RE =
  /catch\s*\([^)]*\)\s*\{\s*(?:return\s+[^;{]+;?\s*)?\}/g;

const AUDIT_EVENT_RE =
  /\b(?:audit(?:Log(?:ger)?)?|logTool(?:Call)?|recordTool(?:Call)?)\s*(?:\.\s*(?:log|write|record|emit|append))?\s*\(\s*\{/gi;

const CORRELATION_RE =
  /\b(?:sessionId|session_id|requestId|request_id|correlationId|correlation_id|traceId|trace_id|userId|user_id|authInfo)\b/;

function locationOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const column = index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
  return { line, column };
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
    owasp: check.owasp,
    recommendation: check.recommendation,
    file: filePath,
    line,
    column,
    match: match.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
    context: "",
  });
}

function isMcpToolFile(text: string): boolean {
  return MCP_SERVER_RE.test(text) || TOOL_REGISTER_RE.test(text);
}

function checkMissingToolAudit(text: string, filePath: string | undefined, findings: Finding[]): void {
  if (!MCP_SERVER_RE.test(text)) return;
  if (!TOOL_REGISTER_RE.test(text)) return;
  if (AUDIT_PRESENCE_RE.test(text)) return;

  const serverMatch = MCP_SERVER_RE.exec(text);
  if (!serverMatch) return;
  pushFinding(findings, "mcp_server_without_tool_audit", text, serverMatch.index, serverMatch[0], filePath);
}

function runGlobal(
  re: RegExp,
  id: string,
  text: string,
  filePath: string | undefined,
  findings: Finding[]
): void {
  const copy = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = copy.exec(text)) !== null) {
    pushFinding(findings, id, text, match.index, match[0], filePath);
    if (match.index === copy.lastIndex) copy.lastIndex++;
  }
}

function checkSilentCatch(text: string, filePath: string | undefined, findings: Finding[]): void {
  if (!isMcpToolFile(text)) return;

  const re = new RegExp(SILENT_CATCH_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const body = match[0];
    if (/\b(?:log|audit|telemetry|console|throw|logger|logging)\b/i.test(body)) {
      if (match.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    pushFinding(findings, "tool_error_swallowed_silently", text, match.index, match[0], filePath);
    if (match.index === re.lastIndex) re.lastIndex++;
  }
}

function checkAuditCorrelation(text: string, filePath: string | undefined, findings: Finding[]): void {
  if (!isMcpToolFile(text)) return;

  const re = new RegExp(AUDIT_EVENT_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const window = text.slice(start, Math.min(text.length, start + 320));
    if (CORRELATION_RE.test(window)) {
      if (match.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    pushFinding(findings, "audit_log_without_correlation_id", text, start, match[0], filePath);
    if (match.index === re.lastIndex) re.lastIndex++;
  }
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  checkMissingToolAudit(text, filePath, findings);

  if (isMcpToolFile(text)) {
    runGlobal(RAW_ARGS_LOG_RE, "raw_tool_args_logged", text, filePath, findings);
    runGlobal(RAW_RESULT_LOG_RE, "raw_tool_result_logged", text, filePath, findings);
    checkSilentCatch(text, filePath, findings);
    checkAuditCorrelation(text, filePath, findings);
  }

  // Disabled-audit is useful even outside a tool file (config modules).
  runGlobal(AUDIT_DISABLED_RE, "audit_disabled_in_code", text, filePath, findings);

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
