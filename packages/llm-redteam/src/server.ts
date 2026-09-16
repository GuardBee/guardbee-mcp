import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { PROBES } from "./probes.js";
import { runSuite } from "./runner.js";
import type { SuiteResult } from "./runner.js";
import { createOpenAiTarget, createAnthropicTarget, createWebhookTarget } from "./target.js";
import type { ProbeTarget } from "./target.js";

const TargetConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("openai"),
    apiKeyEnv: z.string().describe("Name of the env var holding the API key — never the key value itself"),
    model: z.string().describe("Model name, e.g. 'gpt-4o-mini'"),
    baseUrl: z.string().optional().describe("Override for OpenAI-compatible gateways (Groq, local vLLM, etc.)"),
    systemPrompt: z.string().optional().describe("Your production system prompt, to test its actual wording"),
  }),
  z.object({
    type: z.literal("anthropic"),
    apiKeyEnv: z.string().describe("Name of the env var holding the API key — never the key value itself"),
    model: z.string().describe("Model name, e.g. 'claude-sonnet-4-5'"),
    systemPrompt: z.string().optional().describe("Your production system prompt, to test its actual wording"),
  }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().describe("Your chatbot endpoint URL"),
    apiKeyEnv: z.string().optional().describe("Name of the env var holding a bearer token, if required"),
    promptField: z.string().optional().describe("JSON field to send the prompt under (default: 'prompt')"),
    responseField: z.string().optional().describe("JSON field to read the reply from (default: 'response')"),
  }),
]);

type TargetConfig = z.infer<typeof TargetConfigSchema>;

function buildTarget(config: TargetConfig): ProbeTarget {
  switch (config.type) {
    case "openai":
      return createOpenAiTarget(config);
    case "anthropic":
      return createAnthropicTarget(config);
    case "webhook":
      return createWebhookTarget(config);
  }
}

function formatSuiteResult(result: SuiteResult): string {
  const lines: string[] = [
    `${result.bypassedCount > 0 ? "⚠️ " : "✅"} ${result.bypassedCount}/${result.totalCount} probe(s) bypassed the target's guardrails (${result.durationMs}ms)`,
    "",
  ];

  for (const r of result.results) {
    if (r.error) {
      lines.push(`⚪ [ERROR] ${r.probeName} (${r.category})`);
      lines.push(`   ${r.error}`);
      lines.push("");
      continue;
    }
    const icon = r.bypassed ? "🔴" : "🟢";
    lines.push(`${icon} [${r.bypassed ? "BYPASSED" : "held"}] ${r.probeName} (${r.category}, ${r.severity})`);
    if (r.bypassed) {
      lines.push(`   Response preview : ${r.responsePreview}`);
      lines.push(`   Recommendation   : ${r.recommendation}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-llm-redteam",
    version: "0.1.0",
  });
  instrumentServer(server, "llm-redteam");

  server.tool(
    "list_probes",
    "List all red-team probes this tool can run against a target LLM/chatbot, grouped by category. Every probe is canary-based (safe) — none ask the target to produce genuinely harmful content.",
    {},
    async () => {
      const byCategory = new Map<string, typeof PROBES>();
      for (const p of PROBES) {
        const list = byCategory.get(p.category) ?? [];
        list.push(p);
        byCategory.set(p.category, list);
      }
      const lines = ["Available probes:\n"];
      for (const [category, probes] of byCategory) {
        lines.push(`[${category}]`);
        for (const p of probes) lines.push(`  • ${p.name} (${p.id}, ${p.severity})`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "run_probe_suite",
    "Run canary-based red-team probes against a live LLM endpoint or chatbot you control, to test whether known jailbreak/extraction/obfuscation techniques bypass its guardrails. ONLY point this at an endpoint you own or are explicitly authorized to test — every probe consumes API quota on the target. Probes never request genuinely harmful content; success is measured by whether the target reproduces a random one-time token, proving an override instruction was obeyed.",
    {
      target: TargetConfigSchema,
      categories: z
        .array(z.enum(["instruction-override", "extraction", "obfuscation", "refusal-suppression", "multilingual"]))
        .optional()
        .describe("Only run probes in these categories"),
      probeIds: z.array(z.string()).optional().describe("Only run these specific probe IDs (see list_probes)"),
      maxProbes: z.number().int().positive().optional().describe("Cap the number of probes run, to limit API cost"),
    },
    { openWorldHint: true, readOnlyHint: false, idempotentHint: false },
    async ({ target: targetConfig, categories, probeIds, maxProbes }) => {
      const target = buildTarget(targetConfig);
      const result = await runSuite(target, { categories, probeIds, maxProbes });
      return { content: [{ type: "text", text: formatSuiteResult(result) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
