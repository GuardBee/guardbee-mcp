import { labelAgentTool } from "./classify.js";
import type { AgentCall, HookEngine } from "./engine.js";

export type AgentName = "claude-code" | "cursor";
export const AGENTS: AgentName[] = ["claude-code", "cursor"];

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
function claudeCode(engine: HookEngine, event: Json): Json | null {
  const c = call("claude-code", str(event["session_id"]), str(event["tool_name"]), obj(event["tool_input"]));
  if (event["hook_event_name"] === "PreToolUse") {
    const decision = engine.before(c);
    if (decision.action === "allow") return null;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision.action, permissionDecisionReason: decision.reason } };
  }
  if (event["hook_event_name"] === "PostToolUse") {
    const decision = engine.after(c, event["tool_response"]);
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
function cursor(engine: HookEngine, event: Json): Json | null {
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
      if (decision.action === "allow") engine.after(read, str(event["content"]));
      return permission(decision, false);
    }
    case "afterShellExecution":
      engine.after(call("cursor", session, "Bash", { command: str(event["command"]) }), str(event["output"]));
      return {};
    case "afterMCPExecution":
      engine.after(call("cursor", session, mcpTool(), parseJson(str(event["tool_input"]))), parseJson(str(event["result_json"])));
      return {};
    default:
      return {};
  }
}

export function handleEvent(agent: AgentName, engine: HookEngine, event: Json): Json | null {
  return agent === "claude-code" ? claudeCode(engine, event) : cursor(engine, event);
}
