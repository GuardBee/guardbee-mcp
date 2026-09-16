#!/usr/bin/env node
import { startServer } from "./server.js";
import { runSuite } from "./runner.js";
import type { ProbeCategory } from "./probes.js";
import type { SuiteResult, ProbeResult } from "./runner.js";
import { createOpenAiTarget, createAnthropicTarget, createWebhookTarget } from "./target.js";
import type { ProbeTarget } from "./target.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const SEV_ICON: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };

function printText(result: SuiteResult): void {
  console.log(
    `${result.bypassedCount > 0 ? "⚠️ " : "✅"} ${result.bypassedCount}/${result.totalCount} probe(s) bypassed the target's guardrails (${result.durationMs}ms)`
  );
  console.log("");

  for (const r of result.results) {
    if (r.error) {
      console.log(`⚪ [ERROR] ${r.probeName} (${r.category})`);
      console.log(`   ${r.error}`);
      console.log("");
      continue;
    }
    const icon = r.bypassed ? "🔴" : "🟢";
    const sevIcon = SEV_ICON[r.severity] ?? "⚪";
    console.log(`${icon} [${r.bypassed ? "BYPASSED" : "held"}] ${sevIcon} ${r.probeName} (${r.category}, ${r.severity})`);
    if (r.bypassed) {
      console.log(`   Response preview : ${r.responsePreview}`);
      console.log(`   Recommendation   : ${r.recommendation}`);
    }
    console.log("");
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) opts[arg.slice(2)] = "true";
    else opts[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return opts;
}

function buildTargetFromArgs(opts: Record<string, string>): ProbeTarget {
  const type = opts["type"];
  if (type === "openai") {
    if (!opts["api-key-env"] || !opts["model"]) {
      throw new Error("--type=openai requires --api-key-env and --model");
    }
    const systemPrompt = opts["system-prompt-file"] ? readFileSync(opts["system-prompt-file"], "utf8") : undefined;
    return createOpenAiTarget({
      apiKeyEnv: opts["api-key-env"],
      model: opts["model"],
      baseUrl: opts["base-url"],
      systemPrompt,
    });
  }
  if (type === "anthropic") {
    if (!opts["api-key-env"] || !opts["model"]) {
      throw new Error("--type=anthropic requires --api-key-env and --model");
    }
    const systemPrompt = opts["system-prompt-file"] ? readFileSync(opts["system-prompt-file"], "utf8") : undefined;
    return createAnthropicTarget({
      apiKeyEnv: opts["api-key-env"],
      model: opts["model"],
      systemPrompt,
    });
  }
  if (type === "webhook") {
    if (!opts["url"]) throw new Error("--type=webhook requires --url");
    return createWebhookTarget({
      url: opts["url"],
      apiKeyEnv: opts["api-key-env"],
      promptField: opts["prompt-field"],
      responseField: opts["response-field"],
    });
  }
  throw new Error(`Unknown or missing --type (expected openai | anthropic | webhook), got: ${type}`);
}

function shouldFail(result: SuiteResult, failOn: string): boolean {
  if (failOn === "none") return false;
  const bypassed = result.results.filter((r: ProbeResult) => r.bypassed);
  if (failOn === "any") return bypassed.length > 0;
  const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = RANK[failOn] ?? 1;
  return bypassed.some((r) => (RANK[r.severity] ?? 3) <= threshold);
}

async function runCli(rawArgs: string[]): Promise<void> {
  const opts = parseArgs(rawArgs);

  let target: ProbeTarget;
  try {
    target = buildTargetFromArgs(opts);
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  }

  const categories = opts["categories"]?.split(",") as ProbeCategory[] | undefined;
  const probeIds = opts["probe-ids"]?.split(",");
  const maxProbes = opts["max-probes"] ? parseInt(opts["max-probes"], 10) : undefined;
  const format = opts["format"] ?? "text";
  const failOn = opts["fail-on"] ?? "any";

  const result = await runSuite(target, { categories, probeIds, maxProbes });

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printText(result);
  }

  process.exit(shouldFail(result, failOn) ? 1 : 0);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-llm-redteam v${getVersion()}

Usage (MCP server):
  guardbee-llm-redteam [serve]

Usage (CLI):
  guardbee-llm-redteam probe --type=openai --model=gpt-4o-mini --api-key-env=OPENAI_API_KEY
  guardbee-llm-redteam probe --type=anthropic --model=claude-sonnet-4-5 --api-key-env=ANTHROPIC_API_KEY
  guardbee-llm-redteam probe --type=webhook --url=https://your-chatbot.example.com/chat

Options:
  --api-key-env=<VAR>       Env var holding the target's API key (never pass the key itself)
  --base-url=<url>          Override API base URL (openai type — for OpenAI-compatible gateways)
  --system-prompt-file=<f>  File containing your production system prompt to test
  --categories=<list>       Comma-separated: instruction-override,extraction,obfuscation,refusal-suppression,multilingual
  --probe-ids=<list>        Comma-separated specific probe IDs
  --max-probes=<n>          Cap the number of probes run (limits API cost)
  --fail-on=<level>         any (default) | critical | high | medium | low | none
  --format=<fmt>            text (default) | json

Exit codes:
  0  No bypasses found (or none above --fail-on threshold)
  1  A guardrail bypass was found at or above threshold
  2  Error / bad arguments

Every probe is canary-based: it never asks the target to produce genuinely
harmful content. Only point this at an endpoint you own or are authorized
to test — each probe consumes API quota on the target.
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-llm-redteam] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
} else if (firstArg === "probe") {
  runCli(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
