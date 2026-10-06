import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { checkById, type ContextOvershareCategory } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: ContextOvershareCategory;
  severity: "critical" | "high" | "medium";
  owasp: "MCP10:2025";
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

const FULL_CONVERSATION_RE =
  /\b(?:return|content\s*:\s*\[\s*\{\s*type\s*:\s*["']text["'])[\s\S]{0,120}?\b(?:messages|conversationHistory|chat_history|conversation_history|fullHistory|full_history)\b/gi;

const MEMORY_TOOL_RE =
  /\.(?:tool|registerTool)\s*\(\s*["'](?:get_all_memories|dump_memory|list_all_memories|list_context|export_memory|dump_context|get_full_context)["']/gi;

const PYTHON_MEMORY_TOOL_RE =
  /@(?:mcp|server)\.tool\s*\(\s*(?:name\s*=\s*)?["'](?:get_all_memories|dump_memory|list_all_memories|list_context|export_memory|dump_context|get_full_context)["']/gi;

const GLOBAL_SESSION_RE =
  /(?:(?:const|let|var)\s+(?:global(?:Session|Context|Memory)|shared(?:Session|Context)|SESSION_STORE|CONTEXT_STORE)\s*=\s*new\s+Map\s*\(\s*\)|(?:^[ \t]*)(?:global_session|shared_context|session_store)\s*=\s*\{\s*\})/gim;

const SYSTEM_PROMPT_LEAK_RE =
  /\b(?:return|content\s*:)[\s\S]{0,100}?\b(?:systemPrompt|SYSTEM_PROMPT|system_prompt|developerInstructions|developer_instructions)\b/gi;

const CROSS_SESSION_RE =
  /\b(?:lastToolResults|toolHistory|previous_tool_results|prior_tool_results)\b[\s\S]{0,80}?\b(?:messages|context|prompt)\b|\b(?:messages|context|prompt)\b[\s\S]{0,80}?\b(?:lastToolResults|toolHistory|previous_tool_results)\b/gi;

const VECTOR_NO_FILTER_RE =
  /\.(?:similaritySearch|similarity_search|query|query_points|search)\s*\(\s*[^)]{0,200}\)/gi;

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

function checkVectorWithoutFilter(text: string, filePath: string | undefined, findings: Finding[]): void {
  const re = new RegExp(VECTOR_NO_FILTER_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const call = match[0];
    if (/\b(?:where|filter|metadata|tenantId|tenant_id|userId|user_id)\b/i.test(call)) {
      if (match.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    // Only flag when the surrounding file looks like RAG/vector usage.
    if (!/\b(?:vector|embedding|chroma|qdrant|weaviate|pgvector|retriev)/i.test(text)) {
      if (match.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    pushFinding(findings, "vector_query_without_filter", text, match.index, call, filePath);
    if (match.index === re.lastIndex) re.lastIndex++;
  }
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  runGlobal(FULL_CONVERSATION_RE, "tool_dumps_full_conversation", text, filePath, findings);
  runGlobal(MEMORY_TOOL_RE, "unscoped_memory_recall_tool", text, filePath, findings);
  runGlobal(PYTHON_MEMORY_TOOL_RE, "unscoped_memory_recall_tool", text, filePath, findings);
  runGlobal(GLOBAL_SESSION_RE, "shared_global_session_store", text, filePath, findings);
  runGlobal(SYSTEM_PROMPT_LEAK_RE, "system_prompt_exposed_via_tool", text, filePath, findings);
  runGlobal(CROSS_SESSION_RE, "cross_session_tool_result_reuse", text, filePath, findings);
  checkVectorWithoutFilter(text, filePath, findings);
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
