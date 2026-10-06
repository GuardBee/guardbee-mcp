#!/usr/bin/env node
import { startServer } from "./server.js";
import { scanPath, scanLive, scanCatalogFile } from "./orchestrator.js";
import { buildSarif } from "./sarif.js";
import type { ConnectionTarget, OwaspReport } from "./types.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`@guardbee/mcp-owasp-scan

Usage (MCP server):
  guardbee-owasp-scan [serve]

Usage (CLI):
  guardbee-owasp-scan scan <path>              Static OWASP MCP Top 10 path scan
  guardbee-owasp-scan live --url=<url>         Live tools/list + toxic-flow + poisoning
  guardbee-owasp-scan live --stdio=<cmd> [--arg=...]
  guardbee-owasp-scan catalog <tools.json>     Audit a tools/list JSON dump

Options:
  --format=text|json|sarif
  --fail-on=any|critical|high|medium|none
  --max-files=<n>
  --discover-shadow              Also run MCP09 host discover
  --allowlist=<path>             Allowlist for Shadow MCP discover
`);
}

function parseArgs(args: string[]) {
  const positionals: string[] = [];
  const stdioArgs: string[] = [];
  let format = "text";
  let failOn = "any";
  let maxFiles = 5000;
  let url: string | undefined;
  let stdio: string | undefined;
  let discoverShadow = false;
  let allowlist: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--format=")) format = arg.split("=")[1] ?? "text";
    else if (arg.startsWith("--fail-on=")) failOn = arg.split("=")[1] ?? "any";
    else if (arg.startsWith("--max-files=")) maxFiles = parseInt(arg.split("=")[1] ?? "5000", 10);
    else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else if (arg.startsWith("--stdio=")) stdio = arg.slice("--stdio=".length);
    else if (arg.startsWith("--arg=")) stdioArgs.push(arg.slice("--arg=".length));
    else if (arg === "--discover-shadow") discoverShadow = true;
    else if (arg.startsWith("--allowlist=")) allowlist = arg.slice("--allowlist=".length);
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  return { positionals, format, failOn, maxFiles, url, stdio, stdioArgs, discoverShadow, allowlist };
}

function shouldFail(findings: { severity: string }[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = RANK[failOn] ?? 1;
  return findings.some((f) => (RANK[f.severity] ?? 3) <= threshold);
}

function emit(report: OwaspReport, format: string, failOn: string): void {
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), report.findings), null, 2));
  } else {
    console.log(`Grade ${report.grade} (${report.score}/100) — ${report.totalFindings} finding(s), ${report.durationMs}ms`);
    console.log(`  mode: ${report.mode}  label: ${report.label}`);
    if (report.scannedFiles !== undefined) console.log(`  scannedFiles: ${report.scannedFiles}`);
    if (report.toolCount !== undefined) console.log(`  tools: ${report.toolCount}`);
    console.log("");
    for (const bucket of report.byOwasp) {
      if (bucket.findingCount === 0) continue;
      console.log(`${bucket.id} ${bucket.title}: ${bucket.findingCount}`);
      for (const f of bucket.findings.slice(0, 20)) {
        const loc = f.file ? `${f.file}:${f.line ?? 0}` : f.tools?.join(", ") ?? f.source;
        console.log(`  [${f.severity}] ${f.patternName} — ${loc}`);
      }
      if (bucket.findings.length > 20) console.log(`  … +${bucket.findings.length - 20} more`);
      console.log("");
    }
    if (report.totalFindings === 0) console.log("✅ No OWASP MCP Top 10 findings.");
  }
  process.exit(shouldFail(report.findings, failOn) ? 1 : 0);
}

async function main(): Promise<void> {
  const [, , firstArg, ...rest] = process.argv;

  if (!firstArg || firstArg === "serve") {
    await startServer();
    return;
  }
  if (firstArg === "--help" || firstArg === "-h") {
    printHelp();
    process.exit(0);
  }

  const opts = parseArgs(rest);

  if (firstArg === "scan") {
    const path = opts.positionals[0];
    if (!path) {
      console.error("Usage: guardbee-owasp-scan scan <path>");
      process.exit(2);
    }
    const report = scanPath(path, {
      maxFiles: opts.maxFiles,
      discoverShadow: opts.discoverShadow,
      allowlistPath: opts.allowlist,
    });
    emit(report, opts.format, opts.failOn);
    return;
  }

  if (firstArg === "catalog") {
    const path = opts.positionals[0];
    if (!path) {
      console.error("Usage: guardbee-owasp-scan catalog <tools.json>");
      process.exit(2);
    }
    emit(scanCatalogFile(path), opts.format, opts.failOn);
    return;
  }

  if (firstArg === "live") {
    let target: ConnectionTarget;
    if (opts.url) target = { type: "http", url: opts.url };
    else if (opts.stdio) target = { type: "stdio", command: opts.stdio, args: opts.stdioArgs };
    else {
      console.error("Usage: guardbee-owasp-scan live --url=<url> | --stdio=<cmd> [--arg=...]");
      process.exit(2);
    }
    const report = await scanLive(target);
    emit(report, opts.format, opts.failOn);
    return;
  }

  console.error(`Unknown command: ${firstArg}`);
  printHelp();
  process.exit(2);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
