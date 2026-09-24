import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { DESCRIPTION_INJECTION_PATTERNS, MISMATCH_SINK_RULES, READ_ONLY_HINT } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: string;
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
const MAX_BLOCK = 2000;
const MAX_CONTEXT_LENGTH = 240;

interface ToolBlock {
  name: string;
  /** Raw description string content (unescaped as written in source), or null if this .tool() call has no string description (3-arg form). */
  description: string | null;
  /** descriptionOffset is the absolute offset of `description`'s first character in the source, only set when description is non-null. */
  descriptionOffset: number;
  /** Bounded text following the tool name — covers schema + handler for the mismatch check, truncated at the next tool registration. */
  body: string;
  offset: number;
}

/**
 * Finds every `.tool("name", ...)` registration (the MCP TypeScript SDK's
 * `McpServer.tool()` convenience form — the shape every GuardBee server in
 * this monorepo uses) and captures its name, description (if the very next
 * argument is a string literal), and a bounded window of following source as
 * a stand-in for "the rest of this tool's definition". Each block is capped
 * at the next tool registration so a sink in tool B's handler is never
 * misattributed to tool A.
 */
export function extractToolBlocks(text: string): ToolBlock[] {
  const nameRe = /\.tool\(\s*["'`]([\w.-]+)["'`]\s*,\s*/g;
  const starts: Array<{ name: string; start: number; afterName: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(text)) !== null) {
    starts.push({ name: m[1], start: m.index, afterName: m.index + m[0].length });
  }

  return starts.map((entry, i) => {
    const nextStart = starts[i + 1]?.start ?? text.length;
    const end = Math.min(entry.afterName + MAX_BLOCK, nextStart);
    const rest = text.slice(entry.afterName, end);

    let description: string | null = null;
    let descriptionOffset = -1;
    const descMatch = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,/.exec(rest);
    if (descMatch) {
      description = descMatch[2];
      descriptionOffset = entry.afterName + 1; // skip the opening quote
    }

    return { name: entry.name, description, descriptionOffset, body: rest, offset: entry.afterName };
  });
}

function locationOf(text: string, absoluteIndex: number): { line: number; column: number } {
  const before = text.slice(0, absoluteIndex);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const column = absoluteIndex - (lastNl === -1 ? 0 : lastNl + 1) + 1;
  return { line, column };
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const blocks = extractToolBlocks(text);

  for (const block of blocks) {
    // ── Check 1: description-embedded injection ──────────────────────────────
    if (block.description) {
      for (const p of DESCRIPTION_INJECTION_PATTERNS) {
        const re = new RegExp(p.pattern.source, p.pattern.flags.includes("g") ? p.pattern.flags : p.pattern.flags + "g");
        let dm: RegExpExecArray | null;
        while ((dm = re.exec(block.description)) !== null) {
          const absoluteIndex = block.descriptionOffset + dm.index;
          const { line, column } = locationOf(text, absoluteIndex);
          findings.push({
            patternId: p.id,
            patternName: p.name,
            category: "description-injection",
            severity: p.severity,
            recommendation: p.recommendation,
            file: filePath,
            line,
            column,
            match: `tool "${block.name}": ${dm[0].trim().slice(0, MAX_CONTEXT_LENGTH)}`,
            context: block.description.trim().slice(0, MAX_CONTEXT_LENGTH),
          });
          if (dm.index === re.lastIndex) re.lastIndex++;
        }
      }
    }

    // ── Check 2: confused deputy (promised read-only vs. actual sink) ────────
    // Tool names are usually snake_case/kebab-case, so "_"/"-" must become word
    // separators before testing — otherwise "get_system_info" is one long \w
    // token to the regex engine and \bget\b never matches inside it.
    const normalizedName = block.name.replace(/[_-]/g, " ");
    const promisedReadOnly = READ_ONLY_HINT.test(normalizedName) || (block.description ? READ_ONLY_HINT.test(block.description) : false);
    if (!promisedReadOnly) continue;

    for (const rule of MISMATCH_SINK_RULES) {
      const sm = rule.pattern.exec(block.body);
      if (!sm) continue;
      const absoluteIndex = block.offset + sm.index;
      const { line, column } = locationOf(text, absoluteIndex);
      findings.push({
        patternId: `confused_deputy_${rule.id}`,
        patternName: `Confused deputy: "${block.name}" reads as read-only but handler has a ${rule.category} sink`,
        category: "confused-deputy",
        severity: rule.severity,
        recommendation: rule.recommendation,
        file: filePath,
        line,
        column,
        match: `tool "${block.name}": ${sm[0].trim().slice(0, MAX_CONTEXT_LENGTH)}`,
        context: (block.description ?? block.name).trim().slice(0, MAX_CONTEXT_LENGTH),
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
