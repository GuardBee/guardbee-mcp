#!/usr/bin/env node
import { startServer } from "./server.js";
import { scanNpm, scanPip } from "./scanner.js";
import type { Finding, ScanResult } from "./scanner.js";
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

function printText(results: ScanResult[]): void {
  const allFindings = results.flatMap((r) => r.findings);
  const totalChecked = results.reduce((s, r) => s + r.packagesChecked, 0);

  if (allFindings.length === 0) {
    console.log(`✅ All ${totalChecked} declared dependencies exist on their registries, none suspiciously new`);
    return;
  }

  const critical = allFindings.filter((f) => f.severity === "critical");
  const low = allFindings.filter((f) => f.severity === "low");
  console.log(`⚠️  ${allFindings.length} finding(s) across ${totalChecked} dependencies`);
  console.log(`   Critical (does not exist): ${critical.length}  Low (recently published): ${low.length}`);
  console.log("");

  for (const f of [...critical, ...low]) {
    const icon = f.severity === "critical" ? "🔴" : "⚪";
    console.log(`${icon} [${f.severity.toUpperCase()}] ${f.packageName} (${f.ecosystem}${f.isDev ? ", dev" : ""})`);
    console.log(`   ${f.patternName}`);
    console.log(`   Recommendation : ${f.recommendation}`);
    console.log("");
  }
}

function parseArgs(args: string[]): { positionals: string[]; failOn: string; format: string } {
  const positionals: string[] = [];
  let failOn = "critical";
  let format = "text";

  for (const arg of args) {
    if (arg.startsWith("--fail-on=")) failOn = arg.split("=")[1] ?? "critical";
    else if (arg.startsWith("--format=")) format = arg.split("=")[1] ?? "text";
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  return { positionals, failOn, format };
}

function shouldFail(findings: Finding[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "low") return findings.length > 0;
  return findings.some((f) => f.severity === "critical");
}

async function runCli(rawArgs: string[]): Promise<void> {
  const { positionals, failOn: cliFail, format } = parseArgs(rawArgs);
  const target = positionals[0] ?? ".";

  const cfg = loadConfig(target, cliFail !== "critical" ? { failOn: cliFail } : {});
  const cfgPath = configFilePath(target);
  if (cfgPath && format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

  const [npm, pip] = await Promise.all([scanNpm(target), scanPip(target)]);
  const results = [npm, pip].filter((r) => r.packagesChecked > 0);

  if (results.length === 0) {
    console.error(`No package.json, requirements.txt, or pyproject.toml found in ${target}`);
    process.exit(2);
  }

  const allFindings = results.flatMap((r) => r.findings);

  if (format === "json") {
    console.log(JSON.stringify({ results }, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), allFindings), null, 2));
  } else {
    printText(results);
  }

  process.exit(shouldFail(allFindings, cfg.failOn) ? 1 : 0);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-slopsquat-scanner

Usage (MCP server):
  guardbee-slopsquat-scanner [serve]

Usage (CLI):
  guardbee-slopsquat-scanner scan [path]   Check declared dependencies against the real npm/PyPI registries (default path: .)

Options:
  --fail-on=<level>   Exit 1 if issues at this severity or above are found
                      Levels: critical (default) | low | none
  --format=<fmt>      Output format: text (default) | json | sarif

Exit codes:
  0  No issues found (or none above --fail-on threshold)
  1  Issues found at or above threshold
  2  Error / bad arguments
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-slopsquat-scanner] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
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
