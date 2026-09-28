import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { A2A_AUDIT_PATTERNS, type A2AAuditCategory } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: A2AAuditCategory;
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
const MAX_SPAN = 2000;

function locationOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const column = index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
  return { line, column };
}

function clean(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH);
}

/** Walks forward from an opening bracket counting depth to find its match — string-unaware, a bounded heuristic like the rest of this family. */
function findMatchingEnd(text: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0;
  const limit = Math.min(text.length, openIndex + MAX_SPAN);
  for (let i = openIndex; i < limit; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return limit;
}

/**
 * The reference push-notification sender does `const url = pushConfig.url;`
 * then `fetch(url, ...)` a few lines later — a direct regex on the fetch
 * call site alone can't see the client-controlled origin of `url`. This
 * walks back from each bare-variable fetch/axios call looking for a nearby
 * assignment from a *Config.url-shaped field, and only flags it if there's
 * no host-allowlist check in between.
 */
function checkIndirectWebhookSsrf(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /(?:fetch|axios(?:\.\w+)?)\s*\(\s*(\w+)\s*[,)]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const varName = m[1];
    const windowStart = Math.max(0, m.index - 500);
    const before = text.slice(windowStart, m.index);
    const assignRe = new RegExp(`\\b${varName}\\s*=\\s*\\w*(?:push|webhook|notification)\\w*Config\\.url\\b`, "i");
    if (assignRe.test(before) && !/allowlist|isAllowedHost|ALLOWED_HOSTS|\.hostname\s*===/i.test(before)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "webhook_url_indirect_fetch_no_allowlist",
        patternName: "Push-notification webhook URL (via a local variable) fetched with no host allowlist",
        category: "webhook-ssrf",
        severity: "critical",
        recommendation: "This fetch/axios call's URL argument was assigned a few lines earlier from a push-notification config field the client controls, with no allowlist check in between — same SSRF risk as calling fetch(pushConfig.url) directly, just one variable removed. Validate the resolved host before fetching it.",
        file: filePath,
        line,
        column,
        match: clean(text.slice(Math.max(0, m.index - 60), m.index + m[0].length)),
        context: "",
      });
    }
  }
  return findings;
}

/** Both `securitySchemes: {}` and `securityRequirements: []` present near each other is exactly the shape the SDK's own sample agent ships with — an Agent Card that advertises capabilities but requires nothing to invoke them. */
function checkEmptyAgentCardSecurity(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /securitySchemes\s*:\s*\{\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const windowEnd = Math.min(text.length, m.index + 300);
    const window = text.slice(m.index, windowEnd);
    if (/securityRequirements\s*:\s*\[\]/.test(window)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "empty_agent_card_security",
        patternName: "Agent Card declares empty securitySchemes and securityRequirements",
        category: "missing-authentication",
        severity: "high",
        recommendation: "An Agent Card with no security schemes and no security requirements tells every caller this agent needs no authentication at all — this is the exact shape the SDK's own sample agent ships with, which makes it a common copy-paste trap. Declare at least one securityScheme and require it, unless this really is a local-only demo.",
        file: filePath,
        line,
        column,
        match: clean(window),
        context: "",
      });
    }
  }
  return findings;
}

/** Python's AgentCard(...) constructor takes security_schemes/security_requirements as optional kwargs — omitting both silently means "no authentication", same failure mode as the TS empty-object case above, just via absence instead of an explicit empty value. */
function checkPythonAgentCardNoAuth(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /\bAgentCard\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const openParenIndex = m.index + m[0].length - 1;
    const callEnd = findMatchingEnd(text, openParenIndex, "(", ")");
    const callSpan = text.slice(m.index, callEnd);
    if (!/security_schemes/.test(callSpan) && !/security_requirements/.test(callSpan)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "python_agent_card_no_auth",
        patternName: "AgentCard(...) has neither security_schemes nor security_requirements",
        category: "missing-authentication",
        severity: "high",
        recommendation: "Both security_schemes and security_requirements are optional kwargs on the Python SDK's AgentCard — omitting them isn't a validation error, it just means the card advertises no authentication requirement at all. Pass both explicitly unless this really is a local-only demo.",
        file: filePath,
        line,
        column,
        match: clean(callSpan.slice(0, 200)),
        context: "",
      });
    }
  }
  return findings;
}

/** An Agent Card is served publicly at /.well-known/agent-card.json — a literal credential in its metadata (instead of behind a securityScheme) is readable by anyone who fetches it. */
function checkAgentCardCredential(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  // No leading \b: real code often names the variable movieAgentCard/weatherAgentCard,
  // and "Agent" ending in a lowercase-to-uppercase transition has no word boundary there.
  const re = /\w*[Aa]gentCard\s*[=(]\s*\{?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const braceIdx = text.indexOf("{", m.index);
    if (braceIdx === -1 || braceIdx > m.index + 30) continue;
    const spanEnd = findMatchingEnd(text, braceIdx, "{", "}");
    const span = text.slice(braceIdx, spanEnd);
    const credRe = /\b(?:apiKey|api_key|token|secret)\s*[:=]\s*["'][^"']{8,}["']/gi;
    let cm: RegExpExecArray | null;
    while ((cm = credRe.exec(span)) !== null) {
      const absoluteIndex = braceIdx + cm.index;
      const { line, column } = locationOf(text, absoluteIndex);
      findings.push({
        patternId: "agent_card_credential_in_metadata",
        patternName: "Literal credential embedded directly in Agent Card metadata",
        category: "credential-exposure",
        severity: "high",
        recommendation: "An Agent Card is served publicly at /.well-known/agent-card.json (or returned from the equivalent discovery endpoint) — anything in it is readable by anyone who fetches it, no authentication required. Move this credential into a securityScheme (which describes how to authenticate, without containing a live secret) instead of the card's own metadata.",
        file: filePath,
        line,
        column,
        match: clean(cm[0]),
        context: "",
      });
    }
  }
  return findings;
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];

  for (const p of A2A_AUDIT_PATTERNS) {
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
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
        match: clean(m[0]),
        context: "",
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  findings.push(...checkIndirectWebhookSsrf(text, filePath));
  findings.push(...checkEmptyAgentCardSecurity(text, filePath));
  findings.push(...checkPythonAgentCardNoAuth(text, filePath));
  findings.push(...checkAgentCardCredential(text, filePath));

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
