#!/usr/bin/env node
import { startServer } from "./server.js";
import { scanEndpoint, type StoreType } from "./scanner.js";
import type { EndpointScanResult } from "./scanner.js";
import { buildSarif } from "./sarif.js";
import { loadConfig, configFilePath } from "./config.js";
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

const SEV_ICON: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "ℹ️ " };

function printText(result: EndpointScanResult): void {
  console.log(`Target: ${result.target}  (detected: ${result.detectedType}, reachable: ${result.reachable ? "yes" : "no"}, ${result.durationMs}ms)`);
  console.log("");

  const issues = result.findings.filter((f) => f.severity !== "info");
  if (issues.length === 0) {
    console.log("✅ No unauthenticated-access findings.");
  } else {
    const counts: Record<string, number> = {};
    for (const f of issues) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    console.log(`⚠️  ${issues.length} finding(s) — Critical: ${counts["critical"] ?? 0}  High: ${counts["high"] ?? 0}  Medium: ${counts["medium"] ?? 0}  Low: ${counts["low"] ?? 0}`);
  }
  console.log("");

  for (const f of result.findings) {
    const icon = SEV_ICON[f.severity] ?? "⚪";
    console.log(`${icon} [${f.severity.toUpperCase()}] ${f.code}`);
    console.log(`   ${f.message}`);
    console.log(`   Recommendation: ${f.recommendation}`);
    console.log("");
  }
}

function parseArgs(args: string[]): {
  host: string | undefined;
  port?: number;
  type: "auto" | StoreType;
  tls: boolean;
  timeoutMs?: number;
  failOn: string;
  format: string;
} {
  let host: string | undefined;
  let port: number | undefined;
  let type: "auto" | StoreType = "auto";
  let tls = false;
  let timeoutMs: number | undefined;
  let failOn = "any";
  let format = "text";

  for (const arg of args) {
    if (arg.startsWith("--port=")) port = parseInt(arg.split("=")[1] ?? "", 10);
    else if (arg.startsWith("--type=")) type = (arg.split("=")[1] as "auto" | StoreType) ?? "auto";
    else if (arg === "--tls") tls = true;
    else if (arg.startsWith("--timeout-ms=")) timeoutMs = parseInt(arg.split("=")[1] ?? "", 10);
    else if (arg.startsWith("--fail-on=")) failOn = arg.split("=")[1] ?? "any";
    else if (arg.startsWith("--format=")) format = arg.split("=")[1] ?? "text";
    else if (!arg.startsWith("--")) host = arg;
  }

  return { host, port, type, tls, timeoutMs, failOn, format };
}

function shouldFail(result: EndpointScanResult, failOn: string): boolean {
  const issues = result.findings.filter((f) => f.severity !== "info");
  if (failOn === "none") return false;
  if (failOn === "any") return issues.length > 0;
  const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = RANK[failOn] ?? 1;
  return issues.some((f) => (RANK[f.severity] ?? 3) <= threshold);
}

async function runCli(rawArgs: string[]): Promise<void> {
  const { host, port, type, tls, timeoutMs, failOn: cliFail, format } = parseArgs(rawArgs);

  if (!host) {
    console.error("Usage: guardbee-vector-store-scanner scan <host> [--port=N] [--type=auto|weaviate|qdrant|chroma|elasticsearch|redis|postgres] [--tls] [--fail-on=any]");
    process.exit(2);
  }

  const cfg = loadConfig(process.cwd(), {
    ...(cliFail !== "any" ? { failOn: cliFail } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  const cfgPath = configFilePath(process.cwd());
  if (cfgPath && format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

  const result = await scanEndpoint({ host, port, type, tls, timeoutMs: cfg.timeoutMs });

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), result), null, 2));
  } else {
    printText(result);
  }

  process.exit(shouldFail(result, cfg.failOn) ? 1 : 0);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-vector-store-scanner

Usage (MCP server):
  guardbee-vector-store-scanner [serve]

Usage (CLI):
  guardbee-vector-store-scanner scan <host>    Probe a vector-store endpoint for unauthenticated exposure

Options:
  --port=<n>          Port to probe (defaults to the store type's conventional port)
  --type=<type>        auto (default) | weaviate | qdrant | chroma | elasticsearch | redis | postgres
  --tls                Use https:// for HTTP-based probes
  --timeout-ms=<n>     Per-request timeout in milliseconds (default: 4000)
  --fail-on=<level>    Exit 1 if issues at this severity or above are found
                       Levels: any (default) | critical | high | medium | low | none
  --format=<fmt>       Output format: text (default) | json | sarif

Exit codes:
  0  No issues found (or none above --fail-on threshold)
  1  Issues found at or above threshold
  2  Error / bad arguments
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-vector-store-scanner] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
} else if (firstArg === "scan") {
  runCli(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
