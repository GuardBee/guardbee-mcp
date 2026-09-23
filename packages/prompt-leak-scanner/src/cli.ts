#!/usr/bin/env node
import { startServer } from "./server.js";
import { scanFile, scanDirectory } from "./scanner.js";
import type { Finding } from "./scanner.js";
import { buildSarif } from "./sarif.js";
import { loadConfig, configFilePath } from "./config.js";
import { startProxy, type ProxyMode, type AuditEvent } from "./proxy.js";
import { statSync, readFileSync } from "fs";
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

function printText(findings: Finding[], scannedFiles: number, durationMs: number): void {
  if (findings.length === 0) {
    console.log(`✅ No leaked credentials or PII found in ${scannedFiles} file(s) (${durationMs}ms)`);
    return;
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  console.log(`⚠️  Found ${findings.length} finding(s) in ${scannedFiles} file(s) (${durationMs}ms)`);
  console.log(`   Critical: ${counts["critical"] ?? 0}  High: ${counts["high"] ?? 0}  Medium: ${counts["medium"] ?? 0}  Low: ${counts["low"] ?? 0}`);
  console.log("");

  for (const f of findings) {
    const icon = SEV_ICON[f.severity] ?? "⚪";
    console.log(`${icon} [${f.severity.toUpperCase()}] ${f.patternName} (${f.category})`);
    console.log(`   Location       : ${f.location}:${f.line}:${f.column}`);
    console.log(`   Value          : ${f.maskedMatch} (masked)`);
    console.log(`   Recommendation : ${f.recommendation}`);
    console.log("");
  }
}

function parseScanArgs(args: string[]): { positionals: string[]; failOn: string; format: string; maxFiles: number } {
  const positionals: string[] = [];
  let failOn = "any";
  let format = "text";
  let maxFiles = 5000;

  for (const arg of args) {
    if (arg.startsWith("--fail-on=")) failOn = arg.split("=")[1] ?? "any";
    else if (arg.startsWith("--format=")) format = arg.split("=")[1] ?? "text";
    else if (arg.startsWith("--max-files=")) maxFiles = parseInt(arg.split("=")[1] ?? "5000", 10);
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  return { positionals, failOn, format, maxFiles };
}

function shouldFail(findings: Finding[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = RANK[failOn] ?? 1;
  return findings.some((f) => (RANK[f.severity] ?? 3) <= threshold);
}

async function runScan(rawArgs: string[]): Promise<void> {
  const { positionals, failOn: cliFail, format, maxFiles: cliMax } = parseScanArgs(rawArgs);

  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-prompt-leak-scanner scan <path> [--fail-on=any] [--format=text|json|sarif]");
    process.exit(2);
  }

  const cfg = loadConfig(target, {
    ...(cliFail !== "any" ? { failOn: cliFail } : {}),
    ...(cliMax !== 5000 ? { maxFiles: cliMax } : {}),
  });
  const cfgPath = configFilePath(target);
  if (cfgPath && format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

  let stat;
  try {
    stat = statSync(target);
  } catch {
    console.error(`Path not found: ${target}`);
    process.exit(2);
  }

  let findings: Finding[];
  let scannedFiles: number;
  let durationMs: number;

  if (stat.isDirectory()) {
    const result = scanDirectory(target, { maxFiles: cfg.maxFiles, exclude: cfg.exclude });
    findings = result.findings;
    scannedFiles = result.scannedFiles;
    durationMs = result.durationMs;
  } else {
    const start = Date.now();
    const result = scanFile(target);
    findings = result.findings;
    scannedFiles = result.skipped ? 0 : 1;
    durationMs = Date.now() - start;
  }

  if (format === "json") {
    console.log(JSON.stringify({ findings, scannedFiles, durationMs }, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), findings), null, 2));
  } else {
    printText(findings, scannedFiles, durationMs);
  }

  process.exit(shouldFail(findings, cfg.failOn) ? 1 : 0);
}

function parseProxyArgs(args: string[]): { port: number; upstream?: string; mode: ProxyMode; failOnSeverity?: Finding["severity"] } {
  let port = 8788;
  let upstream: string | undefined;
  let mode: ProxyMode = "monitor";
  let failOnSeverity: Finding["severity"] | undefined;

  for (const arg of args) {
    if (arg.startsWith("--port=")) port = parseInt(arg.split("=")[1] ?? "8788", 10);
    else if (arg.startsWith("--upstream=")) upstream = arg.split("=")[1];
    else if (arg.startsWith("--mode=")) mode = (arg.split("=")[1] as ProxyMode) ?? "monitor";
    else if (arg.startsWith("--fail-on-severity=")) failOnSeverity = arg.split("=")[1] as Finding["severity"];
  }
  return { port, upstream, mode, failOnSeverity };
}

function runProxy(rawArgs: string[]): void {
  const { port, upstream, mode, failOnSeverity } = parseProxyArgs(rawArgs);
  if (!upstream) {
    console.error("Usage: guardbee-prompt-leak-scanner proxy --upstream=https://api.openai.com [--port=8788] [--mode=monitor|redact|block] [--fail-on-severity=high]");
    process.exit(2);
  }

  startProxy({
    port,
    upstream,
    mode,
    failOnSeverity,
    onAudit: (event: AuditEvent) => {
      process.stdout.write(JSON.stringify(event) + "\n");
    },
  });

  process.stderr.write(`[guardbee-prompt-leak-scanner] Proxying :${port} -> ${upstream} (mode: ${mode})\n`);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-prompt-leak-scanner

Usage (MCP server):
  guardbee-prompt-leak-scanner [serve]

Usage (CLI):
  guardbee-prompt-leak-scanner scan <path>    Scan a file/directory (prompt logs, request-body fixtures)
  guardbee-prompt-leak-scanner proxy --upstream=<url>   Run a live reverse proxy in front of a real LLM API

scan options:
  --fail-on=<level>   Exit 1 if issues at this severity or above are found
                      Levels: any (default) | critical | high | medium | low | none
  --format=<fmt>      Output format: text (default) | json | sarif
  --max-files=<n>     Max files to scan (default: 5000)

proxy options:
  --upstream=<url>          Real API base URL to forward to (required), e.g. https://api.openai.com
  --port=<n>                Local port to listen on (default: 8788)
  --mode=<mode>              monitor (default, forward unchanged + log) | redact (forward with matches replaced) | block (reject the request)
  --fail-on-severity=<sev>   In block mode, minimum severity that triggers a block (default: high)

Audit events (JSON lines, no leaked values included) are written to stdout as the proxy runs.

Exit codes (scan):
  0  No issues found (or none above --fail-on threshold)
  1  Issues found at or above threshold
  2  Error / bad arguments
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-prompt-leak-scanner] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
} else if (firstArg === "scan") {
  runScan(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "proxy") {
  runProxy(rest);
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
