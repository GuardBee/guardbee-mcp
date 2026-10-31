import { labelAgentTool } from "./classify.js";
import type { AgentCall, HookEngine } from "./engine.js";

export type AgentName = "claude-code" | "cursor" | "codex" | "gemini-cli" | "windsurf";
export const AGENTS: AgentName[] = ["claude-code", "cursor", "codex", "gemini-cli", "windsurf"];

/** A hook that must answer through its exit code (Windsurf): exit 2 blocks, stderr is the reason. */
export interface ExitAnswer {
  exitCode: number;
  stderr: string;
}

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});

function call(agent: AgentName, session: string, tool: string, input: Json): AgentCall {
  return { agent, session: session || "unknown", tool, input, labels: labelAgentTool(tool, input) };
}

/**
 * Claude Code: PreToolUse / PostToolUse with the tool's own name and input.
 * Returns what to print on stdout (nothing: no objection, the normal
 * permission flow applies — the hook never answers "allow" for the user).
 */
async function claudeCode(engine: HookEngine, event: Json): Promise<Json | null> {
  const c = call("claude-code", str(event["session_id"]), str(event["tool_name"]), obj(event["tool_input"]));
  if (event["hook_event_name"] === "PreToolUse") {
    const decision = engine.before(c);
    if (decision.action === "allow") return null;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision.action, permissionDecisionReason: decision.reason } };
  }
  if (event["hook_event_name"] === "PostToolUse") {
    const decision = await engine.after(c, event["tool_response"]);
    const context = decision.context ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: decision.context } } : {};
    if (decision.block) return { decision: "block", reason: decision.block, ...context };
    return decision.context ? context : null;
  }
  return null;
}

function parseJson(text: string): Json {
  try {
    return obj(JSON.parse(text));
  } catch {
    return { raw: text };
  }
}

/**
 * Cursor: one event per kind of action. Shell commands are checked as
 * "Bash" and MCP tools as mcp__<server>__<tool>, so one set of rules covers
 * both agents; `upstream: cursor` tells them apart.
 */
async function cursor(engine: HookEngine, event: Json): Promise<Json | null> {
  const session = str(event["conversation_id"]);
  const permission = (decision: { action: string; reason?: string }, askAllowed = true) => {
    const action = decision.action === "ask" && !askAllowed ? "deny" : decision.action;
    return { permission: action, ...(decision.reason ? { user_message: decision.reason, agent_message: decision.reason } : {}) };
  };
  const mcpTool = () => `mcp__${str(event["mcp_server_name"]) || "server"}__${str(event["tool_name"])}`;
  switch (event["hook_event_name"]) {
    case "beforeShellExecution":
      return permission(engine.before(call("cursor", session, "Bash", { command: str(event["command"]), cwd: str(event["cwd"]) })));
    case "beforeMCPExecution":
      return permission(engine.before(call("cursor", session, mcpTool(), parseJson(str(event["tool_input"])))));
    case "beforeReadFile": {
      // Cursor sends the content with the request: once allowed, it is in the agent's context
      const read = call("cursor", session, "Read", { file_path: str(event["file_path"]) });
      const decision = engine.before(read);
      if (decision.action === "allow") await engine.after(read, str(event["content"]));
      return permission(decision, false);
    }
    case "afterShellExecution":
      await engine.after(call("cursor", session, "Bash", { command: str(event["command"]) }), str(event["output"]));
      return {};
    case "afterMCPExecution":
      await engine.after(call("cursor", session, mcpTool(), parseJson(str(event["tool_input"]))), parseJson(str(event["result_json"])));
      return {};
    default:
      return {};
  }
}

/**
 * Codex CLI: the same PreToolUse / PostToolUse protocol as Claude Code.
 * Its shell tool is checked as "Bash", apply_patch as "Edit", MCP tools as
 * mcp__<server>__<tool>.
 */
async function codex(engine: HookEngine, event: Json): Promise<Json | null> {
  const server = str(obj(event["mcp_server"])["name"]);
  let tool = str(event["tool_name"]);
  let input = obj(event["tool_input"]);
  if (server && !tool.startsWith("mcp__")) tool = `mcp__${server}__${tool}`;
  else if (/^(?:shell|exec|local_shell|exec_command)$/i.test(tool)) tool = "Bash";
  else if (tool === "apply_patch") tool = "Edit";
  if (tool === "Bash" && Array.isArray(input["command"])) input = { ...input, command: (input["command"] as unknown[]).map(String).join(" ") };
  if (tool === "Edit" && !input["file_path"]) {
    // A patch names its files in "*** Update File: path" lines
    const files = [...str(input["input"] ?? input["patch"] ?? input["command"]).matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)].map((m) => m[1]!.trim());
    if (files.length) input = { ...input, file_path: files[0] };
  }
  const c = call("codex", str(event["session_id"]), tool, input);
  if (event["hook_event_name"] === "PreToolUse") {
    const decision = engine.before(c);
    if (decision.action === "allow") return null;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision.action, permissionDecisionReason: decision.reason } };
  }
  if (event["hook_event_name"] === "PostToolUse") {
    const decision = await engine.after(c, event["tool_response"]);
    const context = decision.context ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: decision.context } } : {};
    if (decision.block) return { decision: "block", reason: decision.block, ...context };
    return decision.context ? context : null;
  }
  return null;
}

/** Gemini CLI tool names → the Claude Code names the rules use. */
const GEMINI_TOOLS: Record<string, string> = {
  run_shell_command: "Bash",
  read_file: "Read",
  read_many_files: "Read",
  write_file: "Write",
  replace: "Edit",
  web_fetch: "WebFetch",
  google_web_search: "WebSearch",
};

/**
 * Gemini CLI: BeforeTool / AfterTool. It has no "ask": a call that needs
 * approval is denied with the reason (approve it in the policy, or run it
 * yourself). MCP tools arrive as mcp_<server>_<tool>.
 */
async function geminiCli(engine: HookEngine, event: Json): Promise<Json | null> {
  const name = str(event["tool_name"]);
  const raw = obj(event["tool_input"]);
  const server = str(obj(event["mcp_context"])["server_name"]);
  let tool = GEMINI_TOOLS[name] ?? name;
  let input = raw;
  if (tool === "Read" || tool === "Write" || tool === "Edit") input = { ...raw, file_path: str(raw["absolute_path"] ?? raw["file_path"] ?? raw["path"]) };
  if (name.startsWith("mcp_")) {
    const rest = name.slice(4);
    tool = server && rest.startsWith(`${server}_`) ? `mcp__${server}__${rest.slice(server.length + 1)}` : `mcp__${rest.replace("_", "__")}`;
  }
  const c = call("gemini-cli", str(event["session_id"]), tool, input);
  if (event["hook_event_name"] === "BeforeTool") {
    const decision = engine.before(c);
    if (decision.action === "allow") return null;
    const reason = decision.action === "ask" ? `${decision.reason ?? "This call needs approval"} (Gemini CLI hooks cannot ask: approve it in the GuardBee policy or run it yourself)` : (decision.reason ?? "Blocked by GuardBee policy");
    return { decision: "deny", reason };
  }
  if (event["hook_event_name"] === "AfterTool") {
    const decision = await engine.after(c, event["tool_response"]);
    if (decision.block) return { decision: "deny", reason: decision.block };
    return decision.context ? { hookSpecificOutput: { hookEventName: "AfterTool", additionalContext: decision.context } } : null;
  }
  return null;
}

/**
 * Windsurf (Cascade hooks): pre_* events block with exit code 2 and the
 * reason on stderr; post_* events feed the session's taint.
 */
async function windsurf(engine: HookEngine, event: Json): Promise<ExitAnswer | null> {
  const info = obj(event["tool_info"]);
  const session = str(event["trajectory_id"]);
  const block = (decision: { action: string; reason?: string }): ExitAnswer | null =>
    decision.action === "allow" ? null : { exitCode: 2, stderr: decision.action === "ask" ? `${decision.reason ?? "Needs approval"} (Windsurf hooks cannot ask: approve it in the GuardBee policy)` : (decision.reason ?? "Blocked by GuardBee policy") };
  const mcp = () => call("windsurf", session, `mcp__${str(info["mcp_server_name"]) || "server"}__${str(info["mcp_tool_name"])}`, obj(info["mcp_tool_arguments"]));
  switch (event["agent_action_name"]) {
    case "pre_run_command":
      return block(engine.before(call("windsurf", session, "Bash", { command: str(info["command_line"]), cwd: str(info["cwd"]) })));
    case "pre_read_code":
      return block(engine.before(call("windsurf", session, "Read", { file_path: str(info["file_path"]) })));
    case "pre_write_code":
      return block(engine.before(call("windsurf", session, "Edit", { file_path: str(info["file_path"]) })));
    case "pre_mcp_tool_use":
      return block(engine.before(mcp()));
    case "post_mcp_tool_use":
      await engine.after(mcp(), info["mcp_result"] ?? null);
      return null;
    case "post_run_command":
      await engine.after(call("windsurf", session, "Bash", { command: str(info["command_line"]) }), info["output"] ?? "");
      return null;
    default:
      return null;
  }
}

export function handleEvent(agent: AgentName, engine: HookEngine, event: Json): Promise<Json | ExitAnswer | null> {
  switch (agent) {
    case "claude-code":
      return claudeCode(engine, event);
    case "cursor":
      return cursor(engine, event);
    case "codex":
      return codex(engine, event);
    case "gemini-cli":
      return geminiCli(engine, event);
    case "windsurf":
      return windsurf(engine, event);
  }
}

export const isExitAnswer = (value: unknown): value is ExitAnswer => !!value && typeof value === "object" && typeof (value as ExitAnswer).exitCode === "number";
