import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import {
  calibrate,
  compact,
  contextSize,
  installHooks,
  readAlarmState,
  resolvePaths,
  selfCommand,
  toPlanPct,
  weightedTokens,
  type ClaudePaths,
  type HookInstallResult,
} from "@guardbee/mcp-claude-usage-guard";
import { TOOL_OUTPUT_MATCHER } from "./tool-output.js";

export const CONTEXT_HOOK_TAG = "guardbee:token-optimizer";
export const PACKAGE_NAME = "@guardbee/mcp-token-optimizer";

export const DEFAULT_THRESHOLD = 200_000;
/** After the first warning, warn again each time the context grows by this much */
export const DEFAULT_STEP = 100_000;

// The latest call is near the end; a few MB covers it even after a huge tool result
const TAIL_BYTES = 4 * 1024 * 1024;

export interface LastCall {
  context: number;
  model: string;
  /** Cost-weighted tokens one more message at this size costs (re-reading the context from cache) */
  perMessageWeighted: number;
}

/** The main thread's most recent model call in a transcript, read from the file's tail only. */
export function lastMainCall(transcriptPath: string): LastCall | undefined {
  let fd: number | undefined;
  try {
    const size = statSync(transcriptPath).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fd = openSync(transcriptPath, "r");
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // the first line of the tail is usually cut
      }
      if (entry.type !== "assistant" || entry.isSidechain === true) continue;
      const message = entry.message as { model?: string; usage?: Record<string, number> } | undefined;
      const u = message?.usage;
      if (!u) continue;
      const record = { input: u.input_tokens ?? 0, output: 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, model: message?.model ?? "unknown" };
      const context = contextSize(record);
      // Next message: the whole context comes back as a cache read
      return { context, model: record.model, perMessageWeighted: weightedTokens({ ...record, input: 0, cacheWrite: 0, cacheRead: context }) };
    }
  } catch {
    // missing or unreadable transcript
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return undefined;
}

/** 0 below the threshold, then 1, 2, … for each further step crossed. */
export function warningLevel(context: number, threshold = DEFAULT_THRESHOLD, step = DEFAULT_STEP): number {
  if (context < threshold) return 0;
  return 1 + Math.floor((context - threshold) / step);
}

function stateFile(paths: ClaudePaths): string {
  return join(paths.stateDir, "..", "token-optimizer", "context-warnings.json");
}

function readState(paths: ClaudePaths): Record<string, { level: number; at: number }> {
  try {
    return JSON.parse(readFileSync(stateFile(paths), "utf8"));
  } catch {
    return {};
  }
}

function writeState(paths: ClaudePaths, state: Record<string, { level: number; at: number }>): void {
  // Forget sessions untouched for a week so the file stays small
  const cutoff = Date.now() - 7 * 86_400_000;
  for (const [k, v] of Object.entries(state)) if (v.at < cutoff) delete state[k];
  mkdirSync(join(stateFile(paths), ".."), { recursive: true });
  writeFileSync(stateFile(paths), JSON.stringify(state));
}

export type Lang = "en" | "tr";

export interface ContextHookOptions {
  paths?: Partial<ClaudePaths>;
  threshold?: number;
  step?: number;
  lang?: Lang;
  /** Plan share of one message, when calibration exists (injected for tests) */
  planPct?: (weighted: number) => number | undefined;
}

export function warningMessage(call: LastCall, threshold: number, lang: Lang, planPct?: number): string {
  const share = planPct !== undefined && planPct >= 0.1 ? planPct : undefined;
  if (lang === "tr") {
    return (
      `⚠️ Bu oturumun bağlamı ${compact(call.context)} token (eşik ${compact(threshold)}). ` +
      `Her yeni mesaj bunun tamamını yeniden okuyor${share ? `: mesaj başına 5 saatlik limitin ~%${share.toFixed(1)}'i` : ""}. ` +
      `İş bittiyse /compact, konu değiştiyse /clear.`
    );
  }
  return (
    `⚠️ This session's context is ${compact(call.context)} tokens (threshold ${compact(threshold)}). ` +
    `Every new message re-reads all of it${share ? `: ~${share.toFixed(1)}% of the 5-hour limit per message` : ""}. ` +
    `Run /compact when this task is done, or /clear for a new topic.`
  );
}

/**
 * UserPromptSubmit / SessionStart hook: warns the person (not the model) once the session's context
 * passes the threshold, then again at each further step, so it does not nag on every prompt.
 * Returns the hook's JSON output, or undefined for no output.
 */
export function contextHook(input: Record<string, unknown>, options: ContextHookOptions = {}): { systemMessage: string } | undefined {
  const paths = resolvePaths(options.paths);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const step = options.step ?? DEFAULT_STEP;
  const sessionId = typeof input.session_id === "string" ? input.session_id : undefined;
  if (!sessionId) return undefined;

  let call: LastCall | undefined;
  if (typeof input.transcript_path === "string") call = lastMainCall(input.transcript_path);
  // A resumed session reports its size before any new call lands in the transcript
  if (!call && typeof input.context_tokens === "number") {
    call = { context: input.context_tokens, model: "unknown", perMessageWeighted: input.context_tokens * 0.1 };
  }
  if (!call) return undefined;

  const level = warningLevel(call.context, threshold, step);
  const state = readState(paths);
  const previous = state[sessionId]?.level ?? 0;
  if (level === 0 || level <= previous) {
    // /compact or /clear shrank it: re-arm, so the next crossing warns again
    if (level < previous) {
      state[sessionId] = { level, at: Date.now() };
      writeState(paths, state);
    }
    return undefined;
  }
  state[sessionId] = { level, at: Date.now() };
  writeState(paths, state);
  const planPct = options.planPct ? options.planPct(call.perMessageWeighted) : undefined;
  return { systemMessage: warningMessage(call, threshold, options.lang ?? "en", planPct) };
}

/** Plan share per message from the usage guard's calibration; cheap enough for a hook only when calibrated. */
export function planPctFromCalibration(paths?: Partial<ClaudePaths>): (weighted: number) => number | undefined {
  let rate: number | undefined;
  let loaded = false;
  return (weighted) => {
    if (!loaded) {
      loaded = true;
      try {
        // The usage guard's alarm keeps the latest calibration; scanning is the fallback
        rate = readAlarmState(paths).tokensPerPct?.five_hour ?? calibrate({ paths, now: Date.now() }).tokensPerPct.five_hour;
      } catch {
        rate = undefined;
      }
    }
    return rate ? toPlanPct(weighted, "five_hour", { tokensPerPct: { five_hour: rate } }) : undefined;
  };
}

/** Context warnings before each prompt and on resume, and big-tool-output warnings after each tool. */
export function installContextHooks(options: {
  paths?: Partial<ClaudePaths>;
  apply?: boolean;
  scriptPath?: string;
  version: string;
  threshold?: number;
  /** Tokens one tool result must add before it is reported */
  toolThreshold?: number;
  lang?: Lang;
}): HookInstallResult {
  const flags = [
    options.threshold ? `--threshold ${options.threshold}` : "",
    options.toolThreshold ? `--tool-threshold ${options.toolThreshold}` : "",
    options.lang && options.lang !== "en" ? `--lang ${options.lang}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const command = `${selfCommand(options.scriptPath, PACKAGE_NAME, options.version)} hook${flags ? ` ${flags}` : ""}`;
  return installHooks(
    [
      { event: "UserPromptSubmit", command, timeout: 10 },
      { event: "SessionStart", command, matcher: "resume", timeout: 10 },
      { event: "PostToolUse", command, matcher: TOOL_OUTPUT_MATCHER, timeout: 10 },
    ],
    CONTEXT_HOOK_TAG,
    { paths: options.paths, apply: options.apply, backupDir: join(resolvePaths(options.paths).stateDir, "..", "token-optimizer", "backups") }
  );
}
