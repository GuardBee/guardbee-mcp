import { compact, scanTranscripts, summarize, weightedTokens, type ClaudePaths } from "@guardbee/mcp-claude-usage-guard";
import { auditMcpServers, type McpServerEntry } from "./mcp.js";
import { readDefinitionCosts, type DefinitionCost } from "./mcp-defs.js";
import { listSessions, type SessionInfo } from "./sessions.js";

export interface Recommendation {
  impact: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** What to run or call to act on it */
  action: string;
}

export interface OptimizeOptions {
  paths?: Partial<ClaudePaths>;
  hours?: number;
  now?: number;
  /** Context size above which a session should be compacted (default 150k tokens) */
  contextThreshold?: number;
  sessions?: SessionInfo[];
  mcpServers?: McpServerEntry[];
  /** Earlier measure_mcp_definitions results (default: the stored ones) */
  definitionCosts?: DefinitionCost[];
}

// Roughly four characters of tool output per token
const CHARS_PER_TOKEN = 4;

export function optimizationReport(options: OptimizeOptions = {}): Recommendation[] {
  const now = options.now ?? Date.now();
  const hours = options.hours ?? 24;
  const threshold = options.contextThreshold ?? 150_000;
  const recs: Recommendation[] = [];
  const sessions = options.sessions ?? listSessions({ paths: options.paths, hours, now });

  for (const s of sessions) {
    if (s.isSelf || s.currentContext < threshold) continue;
    recs.push({
      impact: s.currentContext >= 2 * threshold ? "high" : "medium",
      title: `Session pid ${s.pid} re-reads ${compact(s.currentContext)} tokens per message`,
      detail: `${s.cwd ?? "?"}: every message in this session sends its whole ${compact(s.currentContext)}-token context again. Compacting usually brings it under 30k.`,
      action: "Run /compact in that session, or /clear when switching to an unrelated task",
    });
  }
  const self = sessions.find((s) => s.isSelf);
  if (self && self.currentContext >= threshold) {
    recs.push({
      impact: "high",
      title: `This session's context is ${compact(self.currentContext)} tokens`,
      detail: "Each further message here re-reads it.",
      action: "Run /compact here once this task is done",
    });
  }
  const idle = sessions.filter((s) => !s.isSelf && s.status !== "busy" && s.cpu < 5 && s.lastActivity && now - s.lastActivity > 6 * 3_600_000);
  if (idle.length) {
    recs.push({
      impact: "low",
      title: `${idle.length} Claude Code session(s) idle for over 6 hours`,
      detail: `pids ${idle.map((s) => s.pid).join(", ")}. Idle sessions cost nothing until a loop, hook or background task wakes them; closing them removes that risk.`,
      action: "stop_sessions with idleHours: 6 (dry run first)",
    });
  }

  const { usage, toolCalls } = scanTranscripts({ paths: options.paths, sinceMs: now - hours * 3_600_000, untilMs: now, includeToolCalls: true });
  const totalChars = toolCalls.reduce((s, c) => s + c.resultChars, 0);

  const running = new Set(sessions.map((s) => s.sessionId));
  const bloated = summarize(usage.filter((r) => !r.isSidechain && !running.has(r.sessionId)), "session").filter((g) => g.peakContext >= 2 * threshold);
  if (bloated.length) {
    const weighted = bloated.reduce((s, g) => s + g.weighted, 0);
    const all = usage.reduce((s, r) => s + weightedTokens(r), 0);
    recs.push({
      impact: "high",
      title: `${bloated.length} past session(s) ran with contexts up to ${compact(Math.max(...bloated.map((g) => g.peakContext)))} tokens`,
      detail: `They spent ${compact(weighted)} weighted tokens, ${all ? ((100 * weighted) / all).toFixed(0) : 0}% of the window's usage. Past ~${compact(threshold)}, most of each message's cost is re-reading old context.`,
      action: "Compact long sessions early (/compact), and start a new session (/clear) per task",
    });
  }

  const byTarget = new Map<string, { calls: number; chars: number; tool: string }>();
  for (const c of toolCalls) {
    if (!c.target) continue;
    const key = `${c.tool}:${c.target}`;
    const t = byTarget.get(key) ?? { calls: 0, chars: 0, tool: c.tool };
    t.calls++;
    t.chars += c.resultChars;
    byTarget.set(key, t);
  }
  const heavy = [...byTarget.entries()].filter(([, t]) => t.chars / CHARS_PER_TOKEN >= 20_000).sort((a, b) => b[1].chars - a[1].chars).slice(0, 5);
  for (const [key, t] of heavy) {
    const target = key.slice(t.tool.length + 1);
    recs.push({
      impact: t.chars / CHARS_PER_TOKEN >= 100_000 ? "high" : "medium",
      title: `${t.tool} of ${target} put ~${compact(t.chars / CHARS_PER_TOKEN)} tokens into context${t.calls > 1 ? ` over ${t.calls} calls` : ""}`,
      detail: "Tool output stays in the context and is re-read on every later turn until the session is compacted.",
      action: t.calls > 2 ? "Read it once with offset/limit, or grep for the part you need" : "Use offset/limit or grep instead of reading the whole file",
    });
  }

  const servers = options.mcpServers ?? auditMcpServers({ paths: options.paths, now, hours: Math.max(hours, 24 * 7) });
  const unused = servers.filter((s) => s.toggleable && !s.disabled && s.calls === 0);
  if (unused.length) {
    recs.push({
      impact: "medium",
      title: `${unused.length} MCP server(s) unused in the last ${Math.max(hours, 24 * 7) / 24} days`,
      detail: unused.map((s) => `${s.name} (${s.scope}${s.project ? `, ${s.project}` : ""})`).join(", "),
      action: "disable_mcp_servers (dry run first); restore_mcp_servers brings them back",
    });
  }
  for (const s of servers) {
    if (!totalChars || s.resultChars / totalChars < 0.2 || s.resultChars / CHARS_PER_TOKEN < 20_000) continue;
    recs.push({
      impact: "medium",
      title: `MCP server ${s.name} produced ${((100 * s.resultChars) / totalChars).toFixed(0)}% of all tool output`,
      detail: `~${compact(s.resultChars / CHARS_PER_TOKEN)} tokens over ${s.calls} calls. Narrower queries, pagination or a summary tool would shrink it.`,
      action: s.toggleable ? "Ask for smaller results, or disable it when not needed" : "Turn it off where it was added (claude.ai connectors, browser extension) when not needed",
    });
  }

  // Measured tool definitions: heavy servers that are rarely called are the cheapest win
  const costs = (options.definitionCosts ?? readDefinitionCosts(options.paths)).filter((c) => c.ok && c.tokens >= 5_000 && now - c.measuredAt < 30 * 86_400_000);
  for (const c of costs) {
    const usageOf = servers.find((s) => s.name === c.name || c.name.startsWith(`${s.name}/`));
    const unusedToo = usageOf ? usageOf.calls === 0 : false;
    recs.push({
      impact: unusedToo || c.tokens >= 20_000 ? "high" : "medium",
      title: `MCP server ${c.name} defines ~${compact(c.tokens)} tokens of tools${unusedToo ? " and was not used" : ""}`,
      detail: `${c.tools} tools${c.largest.length ? `, largest ${c.largest.map((t) => `${t.name} ~${compact(t.tokens)}`).join(", ")}` : ""}. When loaded up front, that is in every session's context.`,
      action: unusedToo ? "disable_mcp_servers (dry run first)" : "Disable it in projects that do not need it, or ask its author to trim descriptions and schemas",
    });
  }

  const subagent = usage.filter((r) => r.isSidechain).length;
  if (usage.length >= 50 && subagent / usage.length > 0.5) {
    recs.push({
      impact: "medium",
      title: `${((100 * subagent) / usage.length).toFixed(0)}% of calls came from subagents`,
      detail: "Each subagent starts cold and rebuilds context the main session already had.",
      action: "Ask for fewer parallel agents, or do small searches inline",
    });
  }
  const opus = summarize(usage, "model").filter((g) => /opus|fable/i.test(g.key));
  const total = summarize(usage, "model").reduce((s, g) => s + g.weighted, 0);
  const opusShare = total ? opus.reduce((s, g) => s + g.weighted, 0) / total : 0;
  if (opusShare > 0.9 && usage.length >= 100) {
    recs.push({
      impact: "low",
      title: `${(opusShare * 100).toFixed(0)}% of usage is on the largest models`,
      detail: "Routine edits, searches and summaries run fine on Sonnet at a fraction of the plan cost.",
      action: "Switch with /model for routine work",
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => rank[a.impact] - rank[b.impact]);
}

export function formatRecommendations(recs: Recommendation[]): string {
  if (recs.length === 0) return "✅ Nothing obvious to trim: contexts are small, no unused MCP servers, no oversized tool output.";
  const icon = { high: "🔴", medium: "🟠", low: "🔵" };
  return recs.map((r) => `${icon[r.impact]} [${r.impact.toUpperCase()}] ${r.title}\n   ${r.detail}\n   → ${r.action}`).join("\n\n");
}
