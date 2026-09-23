import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { LEAK_PATTERNS, type LeakPattern } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: LeakPattern["category"];
  severity: LeakPattern["severity"];
  recommendation: string;
  location: string;
  line: number;
  column: number;
  /** The leaked value itself, masked — never echoed back in full (we'd otherwise be re-leaking the very thing we just found). */
  maskedMatch: string;
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
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "dist", "build", ".next", "coverage"]);
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

function maskMatch(raw: string): string {
  if (raw.length <= 6) return "*".repeat(raw.length);
  return `${raw.slice(0, 3)}…${raw.slice(-2)}`;
}

export function scanText(text: string, location = "input"): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");

  for (const p of LEAK_PATTERNS) {
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matchStr = m[0];
      if (p.validate && !p.validate(matchStr)) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }

      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const lastNl = before.lastIndexOf("\n");
      const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;

      findings.push({
        patternId: p.id,
        patternName: p.name,
        category: p.category,
        severity: p.severity,
        recommendation: p.recommendation,
        location,
        line,
        column,
        maskedMatch: maskMatch(matchStr),
      });

      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  return findings;
}

/** Same as scanText, but also returns the text with every valid match replaced by a redaction placeholder. */
export function scanAndRedactText(text: string, location = "input"): { findings: Finding[]; redactedText: string } {
  const findings: Finding[] = [];
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const p of LEAK_PATTERNS) {
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matchStr = m[0];
      if (p.validate && !p.validate(matchStr)) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }

      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const lastNl = before.lastIndexOf("\n");
      const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;

      findings.push({
        patternId: p.id,
        patternName: p.name,
        category: p.category,
        severity: p.severity,
        recommendation: p.recommendation,
        location,
        line,
        column,
        maskedMatch: maskMatch(matchStr),
      });
      replacements.push({ start: m.index, end: m.index + matchStr.length, replacement: `[REDACTED:${p.id}]` });

      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  replacements.sort((a, b) => a.start - b.start);
  let redactedText = "";
  let cursor = 0;
  for (const r of replacements) {
    if (r.start < cursor) continue; // overlapping match already redacted by an earlier pattern
    redactedText += text.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
  }
  redactedText += text.slice(cursor);

  return { findings, redactedText };
}

// ── Chat-message body extraction (OpenAI/Anthropic-style request bodies) ──────

interface TextField {
  location: string;
  text: string;
  setText: (newText: string) => void;
}

function extractTextFields(body: unknown): TextField[] {
  const fields: TextField[] = [];
  if (typeof body !== "object" || body === null) return fields;
  const b = body as Record<string, unknown>;

  if (typeof b.system === "string") {
    const parentB = b;
    fields.push({ location: "system", text: b.system, setText: (t) => { parentB.system = t; } });
  }

  if (Array.isArray(b.messages)) {
    b.messages.forEach((msg: unknown, i: number) => {
      if (typeof msg !== "object" || msg === null) return;
      const m = msg as Record<string, unknown>;
      if (typeof m.content === "string") {
        fields.push({ location: `messages[${i}].content`, text: m.content, setText: (t) => { m.content = t; } });
      } else if (Array.isArray(m.content)) {
        m.content.forEach((block: unknown, j: number) => {
          if (typeof block !== "object" || block === null) return;
          const bl = block as Record<string, unknown>;
          if (typeof bl.text === "string") {
            fields.push({ location: `messages[${i}].content[${j}].text`, text: bl.text, setText: (t) => { bl.text = t; } });
          }
        });
      }
    });
  }

  return fields;
}

export function scanBody(body: unknown): { findings: Finding[] } {
  const fields = extractTextFields(body);
  const findings: Finding[] = [];
  for (const field of fields) findings.push(...scanText(field.text, field.location));
  return { findings };
}

/** Redacts matches in place within `body`'s message/system text fields and returns the same (mutated) object. */
export function redactBody(body: unknown): { findings: Finding[]; redactedBody: unknown } {
  const fields = extractTextFields(body);
  const findings: Finding[] = [];
  for (const field of fields) {
    const { findings: fFindings, redactedText } = scanAndRedactText(field.text, field.location);
    findings.push(...fFindings);
    if (fFindings.length > 0) field.setText(redactedText);
  }
  return { findings, redactedBody: body };
}

// ── File / directory scanning (CI use — request-body fixtures, prompt logs) ───

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

  if (ext === ".json") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && (Array.isArray((parsed as Record<string, unknown>).messages) || typeof (parsed as Record<string, unknown>).system === "string")) {
        return { findings: scanBody(parsed).findings.map((f) => ({ ...f, location: `${filePath}:${f.location}` })), skipped: false };
      }
    } catch {
      // fall through to plain-text scanning
    }
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
