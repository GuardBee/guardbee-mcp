import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import {
  buildEvent,
  buildSarif,
  evaluateEvent,
  getEngine,
  GUARDBEE_CATEGORY_HINTS,
  listLoadedRules,
  readTextFile,
  ruleStats,
  type EvaluateResult,
  type Lane,
} from "./engine.js";

function formatResult(result: EvaluateResult): string {
  const lines = [
    `ATR matches: ${result.matchCount} (highest: ${result.highestSeverity ?? "none"}) in ${result.durationMs}ms`,
    `Rules loaded: ${result.atrRuleCount} upstream ATR + ${result.guardbeeRuleCount} GuardBee`,
    "",
  ];
  if (result.matchCount === 0) {
    lines.push("✅ No ATR / GuardBee rules matched.");
    return lines.join("\n");
  }
  for (const m of result.matches) {
    lines.push(`[${m.severity.toUpperCase()}] ${m.ruleId} — ${m.title} (${m.source})`);
    lines.push(`  category   : ${m.category} (confidence ${m.confidence})`);
    if (m.owaspLlm?.length) lines.push(`  owasp_llm  : ${m.owaspLlm.join(", ")}`);
    if (m.owaspAgentic?.length) lines.push(`  owasp_agentic: ${m.owaspAgentic.join(", ")}`);
    if (m.matchedPatterns.length) {
      lines.push(`  patterns   : ${m.matchedPatterns.slice(0, 5).join(" | ")}`);
    }
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

async function runEval(
  content: string,
  opts: {
    type?: Parameters<typeof buildEvent>[0]["type"];
    lane?: Lane;
    scanContext?: "mcp" | "skill";
    format?: "text" | "json" | "sarif";
  }
) {
  const { engine, atrRuleCount, guardbeeRuleCount } = await getEngine(opts.lane ?? "hunt");
  const result = evaluateEvent(engine, buildEvent({ content, type: opts.type, scanContext: opts.scanContext }), {
    atrRuleCount,
    guardbeeRuleCount,
  });
  if (opts.format === "json") return JSON.stringify(result, null, 2);
  if (opts.format === "sarif") return JSON.stringify(buildSarif("0.1.0", result), null, 2);
  return formatResult(result);
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-threat-rules",
    version: "0.1.0",
  });
  instrumentServer(server, "threat-rules");

  server.tool(
    "evaluate_text",
    "Evaluate free text against Agent Threat Rules (ATR) plus GuardBee KVKK/TR rules. Returns matches with follow-up scanner hints.",
    {
      content: z.string().describe("Text to evaluate"),
      type: eventTypeSchema.describe("ATR event type (default: llm_input)"),
      lane: z.enum(["enforce", "alert", "hunt"]).optional().describe("Detection lane (default: hunt)"),
      scanContext: z.enum(["mcp", "skill"]).optional(),
      format: z.enum(["text", "json", "sarif"]).optional(),
    },
    async ({ content, type, lane, scanContext, format }) => {
      const text = await runEval(content, {
        type,
        lane: lane as Lane | undefined,
        scanContext,
        format,
      });
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "evaluate_file",
    "Read a local file and evaluate its contents against ATR + GuardBee rules",
    {
      path: z.string().describe("Path to a text file (max 2MB)"),
      type: eventTypeSchema,
      lane: z.enum(["enforce", "alert", "hunt"]).optional(),
      format: z.enum(["text", "json", "sarif"]).optional(),
    },
    async ({ path: filePath, type, lane, format }) => {
      try {
        const content = readTextFile(filePath);
        const text = await runEval(content, {
          type,
          lane: lane as Lane | undefined,
          format,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "evaluate_event",
    "Evaluate a structured ATR AgentEvent JSON (type, content, fields, sessionId, …).",
    {
      event: z
        .string()
        .describe("JSON AgentEvent: { type, content, fields?, sessionId?, agentId?, scanContext? }"),
      lane: z.enum(["enforce", "alert", "hunt"]).optional(),
      format: z.enum(["text", "json", "sarif"]).optional(),
    },
    async ({ event, lane, format }) => {
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
        return {
          content: [{ type: "text", text: "event.content (string) is required" }],
          isError: true,
        };
      }
      const { engine, atrRuleCount, guardbeeRuleCount } = await getEngine(
        (lane as Lane | undefined) ?? "hunt"
      );
      const result = evaluateEvent(engine, buildEvent(parsed), { atrRuleCount, guardbeeRuleCount });
      const text =
        format === "json"
          ? JSON.stringify(result, null, 2)
          : format === "sarif"
            ? JSON.stringify(buildSarif("0.1.0", result), null, 2)
            : formatResult(result);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "list_rules",
    "List loaded ATR + GuardBee detection rules (optionally filter by category or source).",
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
      source: z.enum(["atr", "guardbee"]).optional(),
      lane: z.enum(["enforce", "alert", "hunt"]).optional(),
    },
    async ({ category, source, lane }) => {
      const { engine } = await getEngine((lane as Lane | undefined) ?? "hunt");
      let rules = listLoadedRules(engine, category);
      if (source) rules = rules.filter((r) => r.source === source);
      const stats = ruleStats(engine);
      const lines = [
        `${rules.length} rule(s)${category ? ` in ${category}` : ""}${source ? ` [${source}]` : ""}`,
        `totals: ${stats.bySource.atr} ATR + ${stats.bySource.guardbee} GuardBee`,
        "",
      ];
      for (const r of rules.slice(0, 200)) {
        lines.push(`- [${r.severity}] ${r.id} — ${r.title} (${r.category}, ${r.source})`);
      }
      if (rules.length > 200) lines.push(`… and ${rules.length - 200} more`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "rule_stats",
    "Summarize loaded rule counts by category and source (ATR vs GuardBee)",
    {
      lane: z.enum(["enforce", "alert", "hunt"]).optional(),
    },
    async ({ lane }) => {
      const { engine } = await getEngine((lane as Lane | undefined) ?? "hunt");
      return {
        content: [{ type: "text", text: JSON.stringify(ruleStats(engine), null, 2) }],
      };
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
        "This package loads upstream ATR rules + GuardBee rules under packages/threat-rules/rules",
        "(KVKK TC Kimlik, Turkish/Chinese injection, Chinese ID, lethal-trifecta intent).",
        "Project overrides: GUARDBEE_ATR_RULES_DIR or .guardbee/atr-rules/",
        "",
        "Category → GuardBee follow-up:",
        "",
        ...Object.entries(GUARDBEE_CATEGORY_HINTS).map(([k, v]) => `• ${k}: ${v}`),
        "",
        "Upstream: https://github.com/Agent-Threat-Rule/agent-threat-rules (MIT)",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
