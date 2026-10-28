#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { applyIgnores, compareToBaseline, readBaseline, writeBaseline } from "./baseline.js";
import type { BaselineDiff } from "./baseline.js";
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

interface CliArgs {
  positionals: string[];
  failOn: string;
  format: string;
  maxFiles: number;
  baseline: string | null;
  updateBaseline: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = { positionals: [], failOn: "any", format: "text", maxFiles: 5000, baseline: null, updateBaseline: false };
  for (const arg of args) {
    const value = arg.slice(arg.indexOf("=") + 1);
    if (arg.startsWith("--fail-on=")) out.failOn = value || "any";
    else if (arg.startsWith("--format=")) out.format = value || "text";
    else if (arg.startsWith("--max-files=")) out.maxFiles = parseInt(value || "5000", 10);
    else if (arg.startsWith("--baseline=")) out.baseline = value;
    else if (arg === "--update-baseline") out.updateBaseline = true;
    else if (!arg.startsWith("--")) out.positionals.push(arg);
  }
  return out;
}

function shouldFail(findings: Finding[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = RANK[failOn] ?? 1;
  return findings.some((f) => (RANK[f.severity] ?? 3) <= threshold);
}

const DEFAULT_BASELINE = ".reverse-shield-baseline.json";

async function runCli(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  const target = args.positionals[0];
  if (!target) {
    console.error("Usage: guardbee-reverse-shield scan <path|url> [--fail-on=any] [--format=text|json|sarif] [--baseline=file] [--update-baseline]");
    process.exit(2);
  }

  const isUrl = /^https?:\/\//i.test(target);
  const cfg = loadConfig(isUrl ? process.cwd() : target, {
    ...(args.failOn !== "any" ? { failOn: args.failOn } : {}),
    ...(args.maxFiles !== 5000 ? { maxFiles: args.maxFiles } : {}),
  });
  const cfgPath = configFilePath(isUrl ? process.cwd() : target);
  if (cfgPath && args.format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

  let result: ScanResult;
  try {
    result = isUrl ? await scanUrl(target) : scanPath(target, { maxFiles: cfg.maxFiles, exclude: cfg.exclude });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }
  applyIgnores(result, cfg.ignore);

  const baselinePath = args.baseline ?? cfg.baseline ?? (args.updateBaseline ? DEFAULT_BASELINE : null);
  if (args.updateBaseline && baselinePath) {
    const written = writeBaseline(baselinePath, result);
    process.stderr.write(`[guardbee] Baseline written: ${baselinePath} (${written.fingerprints.length} finding(s), grade ${written.grade})\n`);
  }
  const diff = baselinePath && !args.updateBaseline && existsSync(baselinePath) ? compareToBaseline(result, readBaseline(baselinePath)) : null;
  if (baselinePath && !args.updateBaseline && !diff) process.stderr.write(`[guardbee] Baseline not found: ${baselinePath} — every finding counts as new\n`);

  if (args.format === "json") {
    console.log(JSON.stringify(diff ? { ...result, baseline: { added: diff.added.length, fixed: diff.fixed, unchanged: diff.unchanged.length, previousGrade: diff.previousGrade } } : result, null, 2));
  } else if (args.format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), result.findings, diff ? new Set(diff.unchanged) : undefined), null, 2));
  } else {
    printText(result);
    if (diff) printDiff(diff, result.grade);
  }

  // With a baseline only what this build newly exposes can fail it; what was
  // already accepted stays visible in the report but does not block.
  const gate = diff ? diff.added : result.findings;
  // exitCode, not exit(): a large JSON/SARIF report piped to another process
  // would otherwise be cut off before stdout drains.
  process.exitCode = shouldFail(gate, cfg.failOn) ? 1 : 0;
}

function printDiff(diff: BaselineDiff, grade: string): void {
  console.log("");
  console.log(`Compared to baseline (grade ${diff.previousGrade} → ${grade}): ${diff.added.length} new, ${diff.fixed.length} fixed, ${diff.unchanged.length} unchanged`);
  for (const f of diff.added) console.log(`   + [${f.severity.toUpperCase()}] ${f.patternId} ${f.file ?? ""}`);
  for (const fp of diff.fixed) console.log(`   - ${fp.split("|").slice(0, 2).join(" ")}`);
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
  --baseline=<file>   Compare with a saved baseline: report new and fixed findings,
                      and fail only on new ones (also: baseline: in guardbee.yml)
  --update-baseline   Write the current findings as the baseline
                      (default file: .reverse-shield-baseline.json)

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
