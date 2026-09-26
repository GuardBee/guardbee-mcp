#!/usr/bin/env node
import { startServer } from "./server.js";
import { baselineServer, checkServer, listBaselines } from "./core.js";
import { buildSarif } from "./sarif.js";
import type { ConnectionTarget } from "./types.js";
import type { CheckResult } from "./core.js";
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

const DEFAULT_BASE_DIR = resolve(process.cwd(), ".guardbee/tool-baselines");

interface ParsedArgs {
  stdio?: string;
  url?: string;
  configFile?: string;
  serverName?: string;
  label?: string;
  baselineDir: string;
  failOn: string;
  format: string;
  autoBaseline: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { baselineDir: DEFAULT_BASE_DIR, failOn: "any", format: "text", autoBaseline: true };
  for (const arg of args) {
    if (arg.startsWith("--stdio=")) parsed.stdio = arg.slice("--stdio=".length);
    else if (arg.startsWith("--url=")) parsed.url = arg.slice("--url=".length);
    else if (arg.startsWith("--config=")) parsed.configFile = arg.slice("--config=".length);
    else if (arg.startsWith("--server=")) parsed.serverName = arg.slice("--server=".length);
    else if (arg.startsWith("--label=")) parsed.label = arg.slice("--label=".length);
    else if (arg.startsWith("--baseline-dir=")) parsed.baselineDir = resolve(arg.slice("--baseline-dir=".length));
    else if (arg.startsWith("--fail-on=")) parsed.failOn = arg.slice("--fail-on=".length);
    else if (arg.startsWith("--format=")) parsed.format = arg.slice("--format=".length);
    else if (arg === "--no-auto-baseline") parsed.autoBaseline = false;
  }
  return parsed;
}

interface McpServersConfig {
  mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; url?: string }>;
}

function resolveTarget(parsed: ParsedArgs): { target: ConnectionTarget; label: string } {
  if (parsed.configFile) {
    if (!parsed.serverName) {
      throw new Error("--config requires --server=<name> to pick which entry to use");
    }
    const config = JSON.parse(readFileSync(parsed.configFile, "utf8")) as McpServersConfig;
    const entry = config.mcpServers?.[parsed.serverName];
    if (!entry) throw new Error(`No server named "${parsed.serverName}" found in ${parsed.configFile}`);
    const label = parsed.label ?? parsed.serverName;
    if (entry.url) return { target: { type: "http", url: entry.url }, label };
    if (!entry.command) throw new Error(`Server "${parsed.serverName}" has neither "command" nor "url"`);
    return { target: { type: "stdio", command: entry.command, args: entry.args, env: entry.env, cwd: entry.cwd }, label };
  }

  if (parsed.url) {
    return { target: { type: "http", url: parsed.url }, label: parsed.label ?? parsed.url };
  }

  if (parsed.stdio) {
    // Simple whitespace split — no shell quoting support. For commands with
    // quoted/spaced arguments, use --config + --server instead.
    const parts = parsed.stdio.trim().split(/\s+/);
    const [command, ...args] = parts;
    const label = parsed.label ?? parsed.stdio;
    return { target: { type: "stdio", command, args }, label };
  }

  throw new Error("Provide a target: --stdio=\"command arg1 arg2\", --url=<http-url>, or --config=<file> --server=<name>");
}

function printCheckResult(result: CheckResult): void {
  if (result.isNewBaseline) {
    console.log(`📌 No prior baseline for "${result.target}" — captured one now (${result.toolCount} tool(s)).`);
    console.log(`   Run 'check' again after this server's next release/update to detect drift.`);
    return;
  }
  if (result.findings.length === 0) {
    console.log(`✅ No drift for "${result.target}" — ${result.toolCount} tool(s) match the stored baseline exactly.`);
    return;
  }

  const counts = { critical: 0, medium: 0, low: 0 };
  for (const f of result.findings) counts[f.severity]++;
  const SEV_ICON: Record<string, string> = { critical: "🔴", medium: "🟡", low: "🔵" };

  console.log(`⚠️  ${result.findings.length} finding(s) for "${result.target}" — Critical: ${counts.critical}  Medium: ${counts.medium}  Low: ${counts.low}`);
  console.log("");
  for (const f of result.findings) {
    console.log(`${SEV_ICON[f.severity]} [${f.severity.toUpperCase()}] ${f.patternName}`);
    console.log(`   Recommendation : ${f.recommendation}`);
    console.log(`   Detail         :`);
    for (const line of f.detail.split("\n")) console.log(`     ${line}`);
    console.log("");
  }
}

function shouldFail(result: CheckResult, failOn: string): boolean {
  if (result.isNewBaseline || failOn === "none") return false;
  if (failOn === "any") return result.findings.length > 0;
  const RANK: Record<string, number> = { critical: 0, medium: 1, low: 2 };
  const threshold = RANK[failOn] ?? 0;
  return result.findings.some((f) => (RANK[f.severity] ?? 2) <= threshold);
}

async function runBaseline(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const { target, label } = resolveTarget(parsed);
  const result = await baselineServer(target, label, parsed.baselineDir);
  console.log(`📌 Baseline captured for "${label}" — ${result.toolCount} tool(s) stored at ${result.baselinePath}`);
}

async function runCheck(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const { target, label } = resolveTarget(parsed);
  const result = await checkServer(target, label, parsed.baselineDir, { autoBaseline: parsed.autoBaseline });

  if (parsed.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (parsed.format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), result.target, result.findings), null, 2));
  } else {
    printCheckResult(result);
  }

  process.exit(shouldFail(result, parsed.failOn) ? 1 : 0);
}

function runListBaselines(args: string[]): void {
  const parsed = parseArgs(args);
  const baselines = listBaselines(parsed.baselineDir);
  if (baselines.length === 0) {
    console.log(`No baselines stored yet in ${parsed.baselineDir}`);
    return;
  }
  for (const b of baselines) {
    console.log(`${b.target}`);
    console.log(`  tools: ${Object.keys(b.tools).length}, captured: ${b.capturedAt}`);
  }
}

function printHelp(): void {
  console.log(`@guardbee/mcp-rug-pull-detector

Usage (MCP server):
  guardbee-rug-pull-detector [serve]

Usage (CLI):
  guardbee-rug-pull-detector baseline <target>   Capture a trusted baseline for a server's current tools
  guardbee-rug-pull-detector check <target>      Compare a server's current tools against its baseline
  guardbee-rug-pull-detector list-baselines      List every server with a stored baseline

Target (pick one):
  --stdio="command arg1 arg2"        Spawn a stdio MCP server (simple whitespace split, no shell quoting)
  --url=<http-url>                   Connect to a Streamable HTTP MCP server
  --config=<file> --server=<name>    Read command/args/env/url from an mcpServers-style JSON config

Options:
  --label=<name>          Stable identifier for this server (default: derived from the target)
  --baseline-dir=<dir>    Where baselines are stored (default: .guardbee/tool-baselines)
  --fail-on=<level>       check: exit 1 at this severity or above (any (default) | critical | medium | low | none)
  --format=<fmt>          check: text (default) | json | sarif
  --no-auto-baseline      check: fail instead of auto-capturing a baseline when none exists yet

Exit codes (check):
  0  No drift (or none above --fail-on threshold), or a new baseline was just captured
  1  Drift found at or above threshold
  2  Error / bad arguments
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-rug-pull-detector] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
} else if (firstArg === "baseline") {
  runBaseline(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "check") {
  runCheck(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "list-baselines") {
  try {
    runListBaselines(rest);
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  }
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
