#!/usr/bin/env node
import { startServer } from "./server.js";
import { scanModelFile, scanDirectory } from "./scanner.js";
import type { Finding } from "./scanner.js";
import { buildSarif } from "./sarif.js";
import { loadConfig, configFilePath } from "./config.js";
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

const SEV_ICON: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

function printText(findings: Finding[], scannedFiles: number, durationMs: number): void {
  if (findings.length === 0) {
    console.log(`✅ No model-file security issues found in ${scannedFiles} file(s) (${durationMs}ms)`);
    return;
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  console.log(`⚠️  Found ${findings.length} model-file security issue(s) in ${scannedFiles} file(s) (${durationMs}ms)`);
  console.log(`   Critical: ${counts["critical"] ?? 0}  High: ${counts["high"] ?? 0}  Medium: ${counts["medium"] ?? 0}  Low: ${counts["low"] ?? 0}`);
  console.log("");

  for (const f of findings) {
    const icon = SEV_ICON[f.severity] ?? "⚪";
    console.log(`${icon} [${f.severity.toUpperCase()}] ${f.patternName} (${f.category})`);
    if (f.file) console.log(`   File           : ${f.file}`);
    if (f.match) console.log(`   Match          : ${f.match}`);
    if (f.context) console.log(`   Context        : ${f.context}`);
    console.log(`   Recommendation : ${f.recommendation}`);
    console.log("");
  }
}

function parseArgs(args: string[]): {
  positionals: string[];
  failOn: string;
  format: string;
  maxFiles: number;
} {
  const positionals: string[] = [];
  let failOn = "any";
  let format = "text";
  let maxFiles = 2000;

  for (const arg of args) {
    if (arg.startsWith("--fail-on=")) failOn = arg.split("=")[1] ?? "any";
    else if (arg.startsWith("--format=")) format = arg.split("=")[1] ?? "text";
    else if (arg.startsWith("--max-files=")) maxFiles = parseInt(arg.split("=")[1] ?? "2000", 10);
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

async function runCli(rawArgs: string[]): Promise<void> {
  const { positionals, failOn: cliFail, format, maxFiles: cliMax } = parseArgs(rawArgs);

  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-model-scanner scan <path> [--fail-on=any] [--format=text|json|sarif]");
    process.exit(2);
  }

  const cfg = loadConfig(target, {
    ...(cliFail !== "any" ? { failOn: cliFail } : {}),
    ...(cliMax !== 2000 ? { maxFiles: cliMax } : {}),
  });
  const cfgPath = configFilePath(target);
  if (cfgPath && format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

  const { failOn, maxFiles } = cfg;

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
    const result = scanDirectory(target, { maxFiles, exclude: cfg.exclude });
    findings = result.findings;
    scannedFiles = result.scannedFiles;
    durationMs = result.durationMs;
  } else {
    const start = Date.now();
    const result = scanModelFile(target);
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

  process.exit(shouldFail(findings, failOn) ? 1 : 0);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-model-scanner

Usage (MCP server):
  guardbee-model-scanner [serve]

Usage (CLI):
  guardbee-model-scanner scan <path>    Scan a model file or a directory of model files

Supported formats:
  .pt .pth .ckpt   PyTorch checkpoints (zip container with data.pkl, or legacy raw pickle)
  .pkl .pickle .bin  Raw pickle streams
  .safetensors     Header structure/integrity validation
  .h5 .hdf5 .keras Keras Lambda-layer RCE heuristic
  .onnx            external_data path-traversal heuristic

Options:
  --fail-on=<level>   Exit 1 if issues at this severity or above are found
                      Levels: any (default) | critical | high | medium | low | none
  --format=<fmt>      Output format: text (default) | json | sarif
  --max-files=<n>     Max files to scan (default: 2000)

Exit codes:
  0  No issues found (or none above --fail-on threshold)
  1  Issues found at or above threshold
  2  Error / bad arguments
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-model-scanner] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
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
