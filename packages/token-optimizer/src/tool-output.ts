import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { compact, resolvePaths, type ClaudePaths } from "@guardbee/mcp-claude-usage-guard";
import type { Lang } from "./context-hook.js";

export const DEFAULT_TOOL_THRESHOLD = 10_000;
/** Tools whose output can be large; edits, todos and the like are not worth starting a hook for */
export const TOOL_OUTPUT_MATCHER = "^(Read|Bash|Grep|Glob|WebFetch|WebSearch|Task|Agent)$|^mcp__";

const CHARS_PER_TOKEN = 4;
// An image costs about this much whatever its base64 length; same figure the transcript scan uses
const IMAGE_CHARS = 6400;
// One warning per session in this span, so a burst of big reads does not flood the screen
const COOLDOWN_MS = 3 * 60_000;

/** Characters a tool result puts into context, counting each image at a flat size. */
export function outputChars(value: unknown, depth = 0): number {
  if (depth > 20 || value === null || value === undefined) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (Array.isArray(value)) return value.reduce((s: number, v) => s + outputChars(v, depth + 1), 0);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.type === "image" || (typeof o.media_type === "string" && o.media_type.startsWith("image/"))) return IMAGE_CHARS;
    let total = 0;
    for (const [k, v] of Object.entries(o)) {
      // Metadata the tool returns about itself, not content in the context
      if (k === "usage" || k === "totalTokens" || k === "totalDurationMs" || k === "durationMs") continue;
      total += outputChars(v, depth + 1);
    }
    return total;
  }
  return 0;
}

function target(toolName: string, input: Record<string, unknown>): string | undefined {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  const value = pick("file_path") ?? pick("path") ?? pick("url") ?? pick("pattern") ?? pick("command") ?? pick("query") ?? pick("description");
  if (!value) return undefined;
  return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}

function advice(toolName: string, lang: Lang): string {
  const tr = lang === "tr";
  if (toolName === "Read") return tr ? "Büyük dosyaları offset/limit ile parça parça oku ya da önce Grep ile yerini bul." : "Read big files in parts with offset/limit, or Grep for the spot first.";
  if (toolName === "Bash") return tr ? "Çıktıyı | head, | tail veya grep ile kısalt." : "Trim the output with | head, | tail or grep.";
  if (toolName === "Grep" || toolName === "Glob") return tr ? "Aramayı daralt (path, glob, head_limit)." : "Narrow the search (path, glob, head_limit).";
  if (toolName === "WebFetch" || toolName === "WebSearch") return tr ? "Sayfadan yalnızca gereken kısmı iste." : "Ask for only the part of the page you need.";
  if (toolName === "Task" || toolName === "Agent") return tr ? "Alt ajandan kısa bir özet döndürmesini iste." : "Ask the subagent to return a short summary.";
  if (toolName.startsWith("mcp__"))
    return tr
      ? "Aracın filtre/sayfalama parametrelerini kullan; hep böyleyse: guardbee-token-optimizer mcp."
      : "Use the tool's filter or paging parameters; if it is always this big: guardbee-token-optimizer mcp.";
  return tr ? "Daha dar bir istek dene." : "Try a narrower request.";
}

export function toolOutputMessage(toolName: string, tokens: number, lang: Lang, what?: string): string {
  const name = what ? `${toolName} (${what})` : toolName;
  if (lang === "tr") {
    return `⚠️ ${name} bağlama ~${compact(tokens)} token ekledi; oturum boyunca her yeni mesajda yeniden okunacak. ${advice(toolName, lang)}`;
  }
  return `⚠️ ${name} added ~${compact(tokens)} tokens to the context; every later message in this session re-reads them. ${advice(toolName, lang)}`;
}

function cooldownFile(paths: ClaudePaths): string {
  return join(paths.stateDir, "..", "token-optimizer", "tool-output-warnings.json");
}

/**
 * PostToolUse hook: tells the person (not the model) when one tool result was big enough to weigh
 * on every later message, with how to get the same answer smaller.
 */
export function toolOutputHook(
  input: Record<string, unknown>,
  options: { paths?: Partial<ClaudePaths>; threshold?: number; lang?: Lang; now?: number } = {}
): { systemMessage: string } | undefined {
  const toolName = typeof input.tool_name === "string" ? input.tool_name : undefined;
  if (!toolName || input.tool_response === undefined) return undefined;
  const tokens = Math.round(outputChars(input.tool_response) / CHARS_PER_TOKEN);
  if (tokens < (options.threshold ?? DEFAULT_TOOL_THRESHOLD)) return undefined;

  const paths = resolvePaths(options.paths);
  const now = options.now ?? Date.now();
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  let state: Record<string, number> = {};
  try {
    state = JSON.parse(readFileSync(cooldownFile(paths), "utf8"));
  } catch {
    // first warning
  }
  if (now - (state[sessionId] ?? 0) < COOLDOWN_MS) return undefined;
  for (const [k, at] of Object.entries(state)) if (now - at > 86_400_000) delete state[k];
  state[sessionId] = now;
  mkdirSync(join(cooldownFile(paths), ".."), { recursive: true });
  writeFileSync(cooldownFile(paths), JSON.stringify(state));

  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
  return { systemMessage: toolOutputMessage(toolName, tokens, options.lang ?? "en", target(toolName, toolInput)) };
}
