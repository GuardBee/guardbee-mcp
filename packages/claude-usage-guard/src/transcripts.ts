import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { resolvePaths, type ClaudePaths } from "./paths.js";

/** One billed model call, read from a Claude Code transcript line. */
export interface UsageRecord {
  ts: number;
  sessionId: string;
  /** Working directory the session ran in */
  project: string;
  model: string;
  /** cli, claude-vscode, sdk-ts, sdk-py, ... */
  entrypoint: string;
  /** True for a subagent's call */
  isSidechain: boolean;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** One tool call and how much text its result put back into the context. */
export interface ToolCallRecord {
  ts: number;
  sessionId: string;
  /** Full tool name, e.g. Read or mcp__github__search_code */
  tool: string;
  /** MCP server name for mcp__<server>__<tool> tools */
  server?: string;
  resultChars: number;
  /** file_path / path / url argument, when the tool had one */
  target?: string;
}

export interface TranscriptScan {
  usage: UsageRecord[];
  toolCalls: ToolCallRecord[];
  files: number;
}

export interface ScanOptions {
  paths?: Partial<ClaudePaths>;
  sinceMs?: number;
  untilMs?: number;
  /** Also collect tool calls (slower; the optimizer needs them, usage reports do not) */
  includeToolCalls?: boolean;
  /** Only this session's transcript (plus its subagents) */
  sessionId?: string;
}

function listTranscripts(dir: string, sinceMs: number, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listTranscripts(full, sinceMs, out);
    else if (entry.name.endsWith(".jsonl")) {
      try {
        // A file not written to since the window opened cannot hold a call inside it
        if (statSync(full).mtimeMs >= sinceMs) out.push(full);
      } catch {
        // vanished between readdir and stat
      }
    }
  }
}

export function mcpServerOf(tool: string): string | undefined {
  if (!tool.startsWith("mcp__")) return undefined;
  const rest = tool.slice(5);
  const end = rest.indexOf("__");
  return end === -1 ? rest : rest.slice(0, end);
}

// Characters charged per image block: ~1,600 tokens at ~4 characters per token
const IMAGE_CHARS = 6_400;

function resultLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as { type?: string; text?: string };
        if (typeof b.text === "string") total += b.text.length;
        // An image costs about (width × height) / 750 tokens, not its base64 length; ~1.6k tokens is typical
        else if (b.type === "image") total += IMAGE_CHARS;
      }
    }
    return total;
  }
  return 0;
}

function targetOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  for (const key of ["file_path", "path", "url", "notebook_path"]) {
    if (typeof i[key] === "string") return i[key] as string;
  }
  return undefined;
}

/**
 * Reads Claude Code transcripts under <claudeDir>/projects. Claude Code writes one line per
 * content block of a response and repeats the response's usage on each, so calls are counted
 * once per message id; summing every line overstates usage two to three times.
 */
export function scanTranscripts(options: ScanOptions = {}): TranscriptScan {
  const paths = resolvePaths(options.paths);
  const since = options.sinceMs ?? 0;
  const until = options.untilMs ?? Number.POSITIVE_INFINITY;
  const files: string[] = [];
  listTranscripts(join(paths.claudeDir, "projects"), since, files);
  const selected = options.sessionId
    ? files.filter((f) => f.includes(options.sessionId as string))
    : files;

  const seen = new Set<string>();
  const usage: UsageRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];

  for (const file of selected) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const pending = new Map<string, { tool: string; target?: string }>();
    for (const line of text.split("\n")) {
      if (!line) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      const message = entry.message as Record<string, unknown> | undefined;
      if (!message || typeof message !== "object") continue;
      const sessionId = String(entry.sessionId ?? "");

      if (options.includeToolCalls && Array.isArray(message.content)) {
        for (const block of message.content as Array<Record<string, unknown>>) {
          if (block?.type === "tool_use" && typeof block.id === "string") {
            pending.set(block.id, { tool: String(block.name), target: targetOf(block.input) });
          } else if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
            const call = pending.get(block.tool_use_id);
            if (!call || !(ts >= since && ts <= until)) continue;
            pending.delete(block.tool_use_id);
            toolCalls.push({
              ts,
              sessionId,
              tool: call.tool,
              server: mcpServerOf(call.tool),
              resultChars: resultLength(block.content),
              target: call.target,
            });
          }
        }
      }

      if (entry.type !== "assistant") continue;
      const u = message.usage as Record<string, number> | undefined;
      if (!u || !(ts >= since && ts <= until)) continue;
      const key = `${String(message.id ?? "")}:${String(entry.requestId ?? "")}`;
      if (key !== ":" && seen.has(key)) continue;
      seen.add(key);
      usage.push({
        ts,
        sessionId,
        project: String(entry.cwd ?? ""),
        model: String(message.model ?? "unknown"),
        entrypoint: String(entry.entrypoint ?? "unknown"),
        isSidechain: entry.isSidechain === true,
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      });
    }
  }
  usage.sort((a, b) => a.ts - b.ts);
  toolCalls.sort((a, b) => a.ts - b.ts);
  return { usage, toolCalls, files: selected.length };
}

/**
 * Approximate relative price of a model family; plan limits are spent in proportion to cost,
 * not raw token count. Unknown families count as the most expensive tier.
 */
export function modelFactor(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return 0.2;
  if (m.includes("sonnet")) return 0.6;
  return 1;
}

/**
 * Cost-weighted tokens, in input-token equivalents: cache reads bill at a tenth of input,
 * cache writes at 1.25x and output at 5x. Raw token totals are dominated by cheap cache reads.
 */
export function weightedTokens(r: Pick<UsageRecord, "input" | "output" | "cacheRead" | "cacheWrite" | "model">): number {
  return (r.input + 1.25 * r.cacheWrite + 0.1 * r.cacheRead + 5 * r.output) * modelFactor(r.model);
}

/** Size of the prompt this call sent: what one more message in the session costs to re-read. */
export function contextSize(r: Pick<UsageRecord, "input" | "cacheRead" | "cacheWrite">): number {
  return r.input + r.cacheRead + r.cacheWrite;
}

export type GroupBy = "session" | "day" | "project" | "entrypoint" | "model";

export interface UsageGroup {
  key: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  weighted: number;
  /** Largest single prompt in the group */
  peakContext: number;
  firstTs: number;
  lastTs: number;
}

function groupKey(r: UsageRecord, by: GroupBy): string {
  switch (by) {
    case "session":
      return r.sessionId;
    case "day":
      return new Date(r.ts).toISOString().slice(0, 10);
    case "project":
      return r.project;
    case "entrypoint":
      return r.entrypoint;
    case "model":
      return r.model;
  }
}

export function summarize(usage: UsageRecord[], by: GroupBy): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();
  for (const r of usage) {
    const key = groupKey(r, by);
    let g = groups.get(key);
    if (!g) {
      g = { key, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, weighted: 0, peakContext: 0, firstTs: r.ts, lastTs: r.ts };
      groups.set(key, g);
    }
    g.calls++;
    g.input += r.input;
    g.output += r.output;
    g.cacheRead += r.cacheRead;
    g.cacheWrite += r.cacheWrite;
    g.weighted += weightedTokens(r);
    g.peakContext = Math.max(g.peakContext, contextSize(r));
    g.firstTs = Math.min(g.firstTs, r.ts);
    g.lastTs = Math.max(g.lastTs, r.ts);
  }
  return [...groups.values()].sort((a, b) => b.weighted - a.weighted);
}
