#!/usr/bin/env node
import { readFileSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { configFilePath, loadConfig } from "./config.js";
import { buildSarif } from "./sarif.js";
import { scanConfigFile, scanDirectory, scanInventory } from "./scanner.js";
import type { ConfigFinding, InventoryServer } from "./types.js";

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

function printText(findings: ConfigFinding[], scannedFiles: number, durationMs: number): void {
  if (findings.length === 0) {
    console.log(`✅ No MCP config issues found in ${scannedFiles} file(s) (${durationMs}ms)`);
    return;
  }
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  console.log(`⚠️  Found ${findings.length} MCP config issue(s) in ${scannedFiles} file(s) (${durationMs}ms)`);
  console.log(
    `   Critical: ${counts.critical ?? 0}  High: ${counts.high ?? 0}  Medium: ${counts.medium ?? 0}  Low: ${counts.low ?? 0}`
  );
  console.log("");
  for (const finding of findings) {
    console.log(`${SEV_ICON[finding.severity] ?? "⚪"} [${finding.severity.toUpperCase()}] ${finding.patternName} (${finding.owasp})`);
    if (finding.server) console.log(`   Server         : ${finding.server}`);
    if (finding.file) console.log(`   File           : ${finding.file}:${finding.line}:${finding.column}`);
    console.log(`   Match          : ${finding.match}`);
    console.log(`   Recommendation : ${finding.recommendation}`);
    console.log("");
  }
}

function shouldFail(findings: ConfigFinding[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = rank[failOn] ?? 1;
  return findings.some((finding) => (rank[finding.severity] ?? 3) <= threshold);
}

function parseArgs(args: string[]): { positionals: string[]; failOn: string; format: string; maxFiles: number } {
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

function emit(findings: ConfigFinding[], scannedFiles: number, durationMs: number, format: string, failOn: string): void {
  if (format === "json") console.log(JSON.stringify({ findings, scannedFiles, durationMs }, null, 2));
  else if (format === "sarif") console.log(JSON.stringify(buildSarif(getVersion(), findings), null, 2));
  else printText(findings, scannedFiles, durationMs);
  process.exit(shouldFail(findings, failOn) ? 1 : 0);
}

async function runScan(rawArgs: string[]): Promise<void> {
  const { positionals, failOn: cliFail, format, maxFiles: cliMax } = parseArgs(rawArgs);
  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-mcp-config-auditor scan <file-or-dir> [--fail-on=any] [--format=text|json|sarif]");
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

  if (stat.isDirectory()) {
    const result = scanDirectory(target, { maxFiles: cfg.maxFiles, exclude: cfg.exclude });
    emit(result.findings, result.scannedFiles, result.durationMs, format, cfg.failOn);
    return;
  }
  const start = Date.now();
  const result = scanConfigFile(target);
  emit(result.findings, result.skipped ? 0 : 1, Date.now() - start, format, cfg.failOn);
}

function runInventory(rawArgs: string[]): void {
  const { positionals, failOn, format } = parseArgs(rawArgs);
  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-mcp-config-auditor inventory <file.json> [--format=text|json|sarif]");
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (err) {
    console.error(`Cannot read inventory: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const servers = Array.isArray((parsed as { servers?: unknown }).servers)
    ? ((parsed as { servers: InventoryServer[] }).servers)
    : null;
  if (!servers) {
    console.error('Inventory JSON must be { "servers": [{ "name": "...", "tools": [{ "name": "...", "description": "..." }] }] }');
    process.exit(2);
  }
  const findings = scanInventory(servers, target);
  emit(findings, 1, 0, format, failOn);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-config-auditor

Usage (MCP server):
  guardbee-mcp-config-auditor [serve]

Usage (CLI):
  guardbee-mcp-config-auditor scan <file-or-dir>   Audit MCP client config files
  guardbee-mcp-config-auditor inventory <file.json>  Cross-server tool shadowing

A directory scan reads only mcp.json, mcp_config.json, and claude_desktop_config.json.
An explicit file path is scanned even when the name differs.

Options:
  --fail-on=<level>   any (default) | critical | high | medium | low | none
  --format=<fmt>      text (default) | json | sarif
  --max-files=<n>     Max files to scan (default: 5000)
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  const { startServer } = await import("./server.js");
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-mcp-config-auditor] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
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
} else if (firstArg === "inventory") {
  try {
    runInventory(rest);
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  }
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
