import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import {
  buildEvent,
  evaluateEvent,
  getEngine,
  GUARDBEE_CATEGORY_HINTS,
  listLoadedRules,
  type EvaluateResult,
  type Lane,
} from "./engine.js";

function formatResult(result: EvaluateResult): string {
  const lines = [
    `ATR matches: ${result.matchCount} (highest: ${result.highestSeverity ?? "none"}) in ${result.durationMs}ms`,
    "",
  ];
  if (result.matchCount === 0) {
    lines.push("✅ No ATR rules matched.");
    return lines.join("\n");
  }
  for (const m of result.matches) {
    lines.push(`[${m.severity.toUpperCase()}] ${m.ruleId} — ${m.title}`);
    lines.push(`  category   : ${m.category} (confidence ${m.confidence})`);
    if (m.owaspLlm?.length) lines.push(`  owasp_llm  : ${m.owaspLlm.join(", ")}`);
    if (m.owaspAgentic?.length) lines.push(`  owasp_agentic: ${m.owaspAgentic.join(", ")}`);
    if (m.matchedPatterns.length) lines.push(`  patterns   : ${m.matchedPatterns.slice(0, 5).join(" | ")}`);
    lines.push(`  GuardBee   : ${m.guardbeeHint}`);
    lines.push("");
  }
  return lines.join("\n");
}

const eventTypeSchema = z
  .enum([
    "llm_input",
    "llm_output",
    "tool_call",
    "tool_response",
    "agent_behavior",
    "multi_agent_message",
    "mcp_exchange",
  ])
  .optional();

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-threat-rules",
    version: "0.1.0",
  });
  instrumentServer(server, "threat-rules");

  server.tool(
    "evaluate_text",
    "Evaluate free text (prompt, tool description, scraped content) against Agent Threat Rules (ATR). Returns matches plus GuardBee follow-up scanner hints.",
    {
      content: z.string().describe("Text to evaluate"),
      type: eventTypeSchema.describe("ATR event type (default: llm_input)"),
      lane: z.enum(["enforce", "alert", "hunt"]).optional().describe("Detection lane (default: hunt)"),
      scanContext: z.enum(["mcp", "skill"]).optional(),
    },
    async ({ content, type, lane, scanContext }) => {
      const engine = await getEngine((lane as Lane | undefined) ?? "hunt");
      const result = evaluateEvent(engine, buildEvent({ content, type, scanContext }));
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "evaluate_event",
    "Evaluate a structured ATR AgentEvent JSON (type, content, fields, sessionId, …).",
    {
      event: z.string().describe("JSON AgentEvent: { type, content, fields?, sessionId?, agentId?, scanContext? }"),
      lane: z.enum(["enforce", "alert", "hunt"]).optional(),
    },
    async ({ event, lane }) => {
      let parsed: {
        type?: Parameters<typeof buildEvent>[0]["type"];
        content: string;
        fields?: Record<string, string>;
        sessionId?: string;
        agentId?: string;
        scanContext?: "mcp" | "skill";
      };
      try {
        parsed = JSON.parse(event) as typeof parsed;
      } catch {
        return { content: [{ type: "text", text: "Invalid JSON for event" }], isError: true };
      }
      if (!parsed.content || typeof parsed.content !== "string") {
        return { content: [{ type: "text", text: "event.content (string) is required" }], isError: true };
      }
      const engine = await getEngine((lane as Lane | undefined) ?? "hunt");
      const result = evaluateEvent(engine, buildEvent(parsed));
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "list_rules",
    "List loaded ATR detection rules (optionally filter by category).",
    {
      category: z
        .enum([
          "prompt-injection",
          "tool-poisoning",
          "context-exfiltration",
          "agent-manipulation",
          "privilege-escalation",
          "excessive-autonomy",
          "data-poisoning",
          "model-abuse",
          "skill-compromise",
        ])
        .optional(),
      lane: z.enum(["enforce", "alert", "hunt"]).optional(),
    },
    async ({ category, lane }) => {
      const engine = await getEngine((lane as Lane | undefined) ?? "hunt");
      const rules = listLoadedRules(engine, category);
      const lines = [`${rules.length} ATR rule(s)${category ? ` in ${category}` : ""}:`, ""];
      for (const r of rules.slice(0, 200)) {
        lines.push(`- [${r.severity}] ${r.id} — ${r.title} (${r.category}, ${r.status})`);
      }
      if (rules.length > 200) lines.push(`… and ${rules.length - 200} more`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "explain_bridge",
    "Explain how Agent Threat Rules (ATR) complements GuardBee static MCP auditors",
    {},
    async () => {
      const lines = [
        "ATR (agent-threat-rules) is a Sigma-like runtime detection layer for agent events.",
        "GuardBee auditors are mostly static/catalog scanners for MCP source and configs.",
        "",
        "Use this bridge to score live text/events with ATR, then jump to GuardBee packages:",
        "",
        ...Object.entries(GUARDBEE_CATEGORY_HINTS).map(([k, v]) => `• ${k}: ${v}`),
        "",
        "Upstream: https://github.com/Agent-Threat-Rule/agent-threat-rules (MIT)",
        "Upstream MCP: npx agent-threat-rules mcp  (or import agent-threat-rules/mcp)",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
