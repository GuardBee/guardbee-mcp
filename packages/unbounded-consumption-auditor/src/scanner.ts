import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { UNBOUNDED_CONSUMPTION_PATTERNS, type UnboundedConsumptionCategory } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: UnboundedConsumptionCategory;
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
const LOOP_WINDOW = 600;
const HANDLER_WINDOW = 1500;

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
 * openai-python and openai-node both use max_tokens; reasoning models (o1+)
 * silently ignore it and need max_completion_tokens instead — so the call
 * span has to be missing BOTH to count as unbounded. Deliberately scoped to
 * .chat.completions.create(...) only: Anthropic's SDK makes max_tokens a
 * required constructor argument (raises before the request is even sent), so
 * a matching check there would be 100% false positives — verified against
 * the SDK's own source before deciding not to ship it.
 */
function checkMissingMaxTokens(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /\.chat\.completions\.create\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const openParenIndex = m.index + m[0].length - 1;
    const callEnd = findMatchingEnd(text, openParenIndex, "(", ")");
    const callSpan = text.slice(m.index, callEnd);
    if (!/\bmax_tokens\b/.test(callSpan) && !/\bmax_completion_tokens\b/.test(callSpan)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "openai_chat_completion_missing_max_tokens",
        patternName: "OpenAI chat completion call has no output token limit",
        category: "missing-token-limit",
        severity: "medium",
        recommendation: "Neither max_tokens nor max_completion_tokens is set on this call — without one, the model can generate up to its own maximum output length on every request, and a single verbose or looping response can multiply your bill (this is the 'unbounded output' half of OWASP LLM Top 10 2026's Unbounded Consumption category). Set max_tokens (or max_completion_tokens for o1+ reasoning models) to the smallest value your use case needs.",
        file: filePath,
        line,
        column,
        match: clean(callSpan.slice(0, 200)),
        context: "",
      });
    }
    if (openParenIndex === re.lastIndex) re.lastIndex++;
  }
  return findings;
}

const LLM_ENDPOINT_HINT = /api\.openai\.com|api\.anthropic\.com|\/chat\/completions|\/v1\/messages/i;

/**
 * The official OpenAI/Anthropic SDKs already ship a bounded client-level
 * timeout (openai-node defaults to 600s) — flagging those would just be
 * noise. The real, citable gap is hand-rolled HTTP calls: requests.post()'s
 * own Quickstart warns that omitting `timeout` can leave a program waiting
 * indefinitely, and axios/bare fetch have the same no-default-timeout shape.
 * Scoped to calls whose own argument span mentions a known LLM endpoint, so a
 * generic internal API call doesn't get swept in.
 */
function checkMissingTimeoutOnRawHttpCall(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /\b(?:requests\.(?:post|get|put|patch)|axios\.(?:post|get|put|patch)|fetch)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const openParenIndex = m.index + m[0].length - 1;
    const callEnd = findMatchingEnd(text, openParenIndex, "(", ")");
    const callSpan = text.slice(m.index, callEnd);
    if (LLM_ENDPOINT_HINT.test(callSpan) && !/\btimeout\b/i.test(callSpan) && !/\bsignal\s*:/i.test(callSpan)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "raw_http_call_to_llm_endpoint_missing_timeout",
        patternName: "Hand-rolled HTTP call to an LLM endpoint has no timeout",
        category: "missing-timeout",
        severity: "medium",
        recommendation: "This call targets an LLM API directly (not through the vendor SDK, which ships its own bounded default) with no timeout/AbortSignal set — requests.post()'s own docs warn that an unset timeout can leave the calling process waiting indefinitely if the endpoint hangs, tying up a worker/thread for a request that never completes. Set an explicit timeout (requests: timeout=; axios: timeout:; fetch: an AbortController signal).",
        file: filePath,
        line,
        column,
        match: clean(callSpan.slice(0, 200)),
        context: "",
      });
    }
    if (openParenIndex === re.lastIndex) re.lastIndex++;
  }
  return findings;
}

const WHILE_TRUE_RE = /while\s*\(\s*true\s*\)|while\s+True\s*:/g;
const CAP_HINT = /max_iter|maxIter|max_turns|maxTurns|iteration_count|iterationCount|step_count|stepCount|MAX_ITER|MAX_TURNS/;
const DISABLED_CAP_RE = /\b(?:max_iterations|max_turns|maxIterations|maxTurns)\s*[:=]\s*None\b/gi;

/** A `max_iterations=None`/`max_turns=None` elsewhere in the window is a disabled cap, not a real one — strip it before testing CAP_HINT so it can't be mistaken for a legitimate nearby iteration limit. */
function hasRealCapHint(window: string): boolean {
  return CAP_HINT.test(window.replace(DISABLED_CAP_RE, ""));
}

/**
 * Real shape (openai-python, quoted from a public agent walkthrough):
 *   while True:
 *       reply = client.chat.completions.create(..., tools=TOOLS)
 *       msg = reply.choices[0].message
 *       if not msg.tool_calls: return msg.content
 *       for call in msg.tool_calls: ...
 * A while(true)/while True: loop that dispatches tool_calls with nothing in
 * a bounded window around it hinting at an iteration cap is exactly this
 * shape. Framework agent executors (LangChain, LangGraph) already default to
 * a bounded loop — see patterns.ts — so this specifically targets hand-rolled
 * loops, which have no such built-in net.
 */
function checkUnboundedToolCallingLoop(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = new RegExp(WHILE_TRUE_RE.source, WHILE_TRUE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(m.index, Math.min(text.length, m.index + LOOP_WINDOW));
    if (/\btool_calls\b|\btoolCalls\b/.test(window) && !hasRealCapHint(window)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "unbounded_tool_calling_loop",
        patternName: "Hand-rolled agent loop dispatches tool calls with no iteration cap",
        category: "unbounded-loop",
        severity: "medium",
        recommendation: "This while(true)/while True: loop calls the model and dispatches tool_calls with nothing nearby suggesting an iteration limit — a model that keeps requesting tools (by design or by a prompt-injected instruction) will run this loop indefinitely, and every turn is a billable call. Add an explicit iteration counter with a hard cap, mirroring the default every major agent framework ships (LangChain's AgentExecutor: 15, LangGraph: 25).",
        file: filePath,
        line,
        column,
        match: clean(window.slice(0, 200)),
        context: "",
      });
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return findings;
}

const RETRY_HINT = /\battempt\b|\bretries\b|retry_count|retryCount|max_retries|maxRetries/i;
const LLM_CALL_HINT = /\.chat\.completions\.create\s*\(|\.messages\.create\s*\(|\bopenai\.|\banthropic\.|\bllm\.call\s*\(|\bllm_call\s*\(/i;
const RETRY_LOOP_WINDOW = 300;

/**
 * OWASP's own Unbounded Consumption writeup calls this out as the same risk
 * from a different trigger: "a failed step might be retried repeatedly."
 * Same while(true)/while True: loop shape as the tool-calling check above,
 * but the absence signal here is an attempt counter rather than an
 * iteration cap, and the trigger is an except/catch + continue rather than
 * a tool dispatch — a caught exception silently sends the loop straight
 * back to the top with no record of how many times it's already tried.
 * Deliberately requires an LLM-call hint in the window too, and uses a much
 * tighter window than the other loop checks: real-world testing against a
 * live open-source codebase found that a generous window picked up
 * `except`/`continue` from an unrelated, perfectly normal retry loop further
 * down in the same function (a pubsub poll, a decorator-unwrapping loop) —
 * neither an LLM/agent call, so not this category's risk at all. Scoping to
 * loops that actually call an LLM keeps this from flagging ordinary
 * polling/retry code.
 */
function checkUnboundedRetryLoop(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = new RegExp(WHILE_TRUE_RE.source, WHILE_TRUE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(m.index, Math.min(text.length, m.index + RETRY_LOOP_WINDOW));
    if (!LLM_CALL_HINT.test(window)) {
      if (m.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    const exceptIdx = window.search(/\bexcept\b|\bcatch\s*\(/);
    if (exceptIdx !== -1) {
      const afterExcept = window.slice(exceptIdx);
      if (/\bcontinue\b/.test(afterExcept) && !RETRY_HINT.test(window)) {
        const { line, column } = locationOf(text, m.index);
        findings.push({
          patternId: "unbounded_retry_loop",
          patternName: "Retry loop re-tries on failure with no attempt cap",
          category: "unbounded-loop",
          severity: "medium",
          recommendation: "This loop catches an exception and continues straight back to the top with nothing tracking how many times it's already retried — OWASP's Unbounded Consumption category calls this out directly: a transient failure (a timeout, a rate-limit response) can turn into an indefinite retry storm, each attempt a billable call. Track an attempt counter and give up (or back off) past a small fixed limit.",
          file: filePath,
          line,
          column,
          match: clean(window.slice(0, 200)),
          context: "",
        });
      }
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return findings;
}

const BILLABLE_CALL_HINT = /\.chat\.completions\.create\s*\(|\.messages\.create\s*\(|\bopenai\.|\banthropic\./;
const RATE_LIMIT_HINT = /rateLimit|RateLimit|TokenBucket|Bottleneck|@limits|limiter\.|throttle/i;

/**
 * Heuristic, deliberately shipped at medium (not critical/high): no MCP SDK
 * (TypeScript or Python) provides a built-in per-caller throttling hook on
 * tool registration, and multiple independent 2026 write-ups (Zuplo,
 * ScaleKit) describe the fix as a hand-rolled wrapper around server.tool()/
 * @mcp.tool() — meaning there's no framework default to fall back on the way
 * LangChain/LangGraph provide for iteration caps. A tool handler that makes
 * a billable downstream call with nothing in its own span suggesting a
 * rate-limiter is the shape those write-ups describe, but this can't see a
 * rate limiter enforced elsewhere (an API gateway, middleware in another
 * file) — see the package README's limitations section.
 */
function checkMcpToolMissingRateLimit(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /server\.tool\s*\(|@mcp\.tool\s*\(\s*\)|@server\.tool\s*\(\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let span: string;
    if (m[0].startsWith("server.tool")) {
      const openParenIndex = m.index + m[0].length - 1;
      const callEnd = findMatchingEnd(text, openParenIndex, "(", ")");
      span = text.slice(m.index, callEnd);
    } else {
      span = text.slice(m.index, Math.min(text.length, m.index + HANDLER_WINDOW));
    }
    if (BILLABLE_CALL_HINT.test(span) && !RATE_LIMIT_HINT.test(span)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "mcp_tool_billable_call_no_rate_limit",
        patternName: "MCP tool handler makes a billable call with no visible rate limiting",
        category: "missing-rate-limit",
        severity: "medium",
        recommendation: "This tool handler calls a billable LLM API with nothing in its own definition suggesting per-caller rate limiting — neither MCP SDK (TypeScript or Python) provides a built-in throttling hook on tool registration, so unlike an agent loop's iteration cap, there's no framework default doing this for you. If a caller (or a compromised/malicious upstream client) invokes this tool in a tight loop, every call is billed with nothing to stop it. Wrap the handler with a rate limiter (a token bucket keyed on caller identity is the common pattern) — this check can't see one enforced elsewhere, e.g. an API gateway.",
        file: filePath,
        line,
        column,
        match: clean(span.slice(0, 200)),
        context: "",
      });
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return findings;
}

export function scanText(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];

  for (const p of UNBOUNDED_CONSUMPTION_PATTERNS) {
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

  findings.push(...checkMissingMaxTokens(text, filePath));
  findings.push(...checkMissingTimeoutOnRawHttpCall(text, filePath));
  findings.push(...checkUnboundedToolCallingLoop(text, filePath));
  findings.push(...checkUnboundedRetryLoop(text, filePath));
  findings.push(...checkMcpToolMissingRateLimit(text, filePath));

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
