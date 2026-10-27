#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { configFilePath, loadConfig } from "./config.js";
import type { Finding } from "./finding.js";
import { scanUrl } from "./live.js";
import { buildSarif } from "./sarif.js";
import { scanPath } from "./scanner.js";
import type { ScanResult } from "./scanner.js";
import { startServer } from "./server.js";

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

function printText(result: ScanResult): void {
  const kinds = result.kinds.length > 0 ? result.kinds.join(", ") : "nothing recognised";
  if (result.findings.length === 0) {
    console.log(`✅ Grade ${result.grade} — no reverse-engineering exposure found in ${result.scannedFiles} file(s) (${kinds}, ${result.durationMs}ms)`);
  } else {
    const counts: Record<string, number> = {};
    for (const f of result.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    console.log(`🛡️  Grade ${result.grade} — ${result.findings.length} reverse-engineering exposure(s) in ${result.scannedFiles} file(s) (${kinds}, ${result.durationMs}ms)`);
    console.log(`   Critical: ${counts["critical"] ?? 0}  High: ${counts["high"] ?? 0}  Medium: ${counts["medium"] ?? 0}  Low: ${counts["low"] ?? 0}`);
    console.log("");
    for (const f of result.findings) {
      console.log(`${SEV_ICON[f.severity] ?? "⚪"} [${f.severity.toUpperCase()}] ${f.patternName} (${f.target}/${f.category})`);
      if (f.file) console.log(`   Where          : ${f.file}${f.line > 1 ? `:${f.line}:${f.column}` : ""}`);
      if (f.match) console.log(`   Evidence       : ${f.match}`);
      console.log(`   Fix            : ${f.recommendation}`);
      console.log("");
    }
  }
  for (const n of result.notes) console.log(`   • ${n}`);
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
    console.error("Usage: guardbee-reverse-shield scan <path|url> [--fail-on=any] [--format=text|json|sarif]");
    process.exit(2);
  }

  let result: ScanResult;
  let failOn = cliFail;
  if (/^https?:\/\//i.test(target)) {
    result = await scanUrl(target);
  } else {
    const cfg = loadConfig(target, {
      ...(cliFail !== "any" ? { failOn: cliFail } : {}),
      ...(cliMax !== 5000 ? { maxFiles: cliMax } : {}),
    });
    const cfgPath = configFilePath(target);
    if (cfgPath && format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);
    failOn = cfg.failOn;
    try {
      result = scanPath(target, { maxFiles: cfg.maxFiles, exclude: cfg.exclude });
    } catch (err) {
      console.error((err as Error).message);
      process.exit(2);
    }
  }

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), result.findings), null, 2));
  } else {
    printText(result);
  }

  // exitCode, not exit(): a large JSON/SARIF report piped to another process
  // would otherwise be cut off before stdout drains.
  process.exitCode = shouldFail(result.findings, failOn) ? 1 : 0;
}

function printHelp(): void {
  console.log(`@guardbee/mcp-reverse-shield

How much does your shipped app give a reverse engineer for free?

Usage (MCP server):
  guardbee-reverse-shield [serve]

Usage (CLI):
  guardbee-reverse-shield scan <path>   Scan an artifact or a build output directory
  guardbee-reverse-shield scan <url>    Scan a live site's same-site bundles and source maps

Recognised artifacts:
  Web        .js .mjs .cjs bundles, .map source maps, build output folders, live URLs
  Electron   .app bundles, app folders with resources/, app.asar (fuses + bundled code)
  Android    .apk (manifest flags, R8 obfuscation, signing, RN bundle, native libs)
  Native     ELF, Mach-O (incl. universal), PE executables and libraries
  .NET       PE assemblies with a CLR header (obfuscation, embedded PDB)

Options:
  --fail-on=<level>   Exit 1 if issues at this severity or above are found
                      Levels: any (default) | critical | high | medium | low | none
  --format=<fmt>      Output format: text (default) | json | sarif
  --max-files=<n>     Max files to check in a directory (default: 5000)

Exit codes:
  0  No issues found (or none above --fail-on threshold)
  1  Issues found at or above threshold
  2  Error / bad arguments
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-reverse-shield] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
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
