#!/usr/bin/env node
import { startServer } from "./server.js";
import { scanFile, scanDirectory } from "./scanner.js";
import type { Finding } from "./scanner.js";
import { buildSarif } from "./sarif.js";
import { applyBaseline, readBaseline, writeBaseline } from "./baseline.js";
import { scanGit } from "./git.js";
import { scanAgentHistory } from "./agent-history.js";
import { loadConfig, configFilePath } from "./config.js";
import { statSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string };
    return pkg.version;
  } catch { return "0.0.0"; }
}

// ── Output ─────────────────────────────────────────────────────────────────────

const SEV_ICON: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

function printText(findings: Finding[], scannedFiles: number, durationMs: number, scope = "file(s)"): void {
  if (findings.length === 0) {
    console.log(`✅ No secrets found in ${scannedFiles} ${scope} (${durationMs}ms)`);
    return;
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  console.log(`⚠️  Found ${findings.length} secret(s) in ${scannedFiles} ${scope} (${durationMs}ms)`);
  console.log(`   Critical: ${counts["critical"] ?? 0}  High: ${counts["high"] ?? 0}  Medium: ${counts["medium"] ?? 0}  Low: ${counts["low"] ?? 0}`);
  console.log("");

  for (const f of findings) {
    const icon = SEV_ICON[f.severity] ?? "⚪";
    console.log(`${icon} [${f.severity.toUpperCase()}] ${f.patternName}`);
    if (f.file) console.log(`   File    : ${f.file}:${f.line}:${f.column}`);
    if (f.commit) console.log(`   Commit  : ${f.commit.slice(0, 12)} ${f.date ?? ""} ${f.author ?? ""}`.trimEnd());
    console.log(`   Match   : ${f.match}`);
    console.log(`   Context : ${f.context}`);
    console.log("");
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────

interface CliArgs {
  positionals: string[];
  failOn: string;
  format: string;
  maxFiles: number;
  staged: boolean;
  /** undefined: no history scan; "": all refs; otherwise a revision range. */
  history?: string;
  maxCommits?: number;
  baseline?: string;
  writeBaseline?: string;
  entropy: boolean;
  agentHistory: boolean;
  home?: string;
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = { positionals: [], failOn: "any", format: "text", maxFiles: 5000, staged: false, entropy: true, agentHistory: false };
  const value = (arg: string) => arg.slice(arg.indexOf("=") + 1);
  for (const arg of args) {
    if (arg.startsWith("--fail-on=")) parsed.failOn = value(arg) || "any";
    else if (arg.startsWith("--format=")) parsed.format = value(arg) || "text";
    else if (arg.startsWith("--max-files=")) parsed.maxFiles = parseInt(value(arg) || "5000", 10);
    else if (arg === "--staged") parsed.staged = true;
    else if (arg === "--no-entropy") parsed.entropy = false;
    else if (arg === "--agent-history") parsed.agentHistory = true;
    else if (arg === "--entropy") parsed.entropy = true;
    else if (arg.startsWith("--home=")) parsed.home = value(arg);
    else if (arg === "--history") parsed.history = "";
    else if (arg.startsWith("--history=")) parsed.history = value(arg);
    else if (arg.startsWith("--max-commits=")) parsed.maxCommits = parseInt(value(arg), 10);
    else if (arg.startsWith("--baseline=")) parsed.baseline = value(arg);
    else if (arg.startsWith("--write-baseline=")) parsed.writeBaseline = value(arg);
    else if (!arg.startsWith("--")) parsed.positionals.push(arg);
  }
  return parsed;
}

function shouldFail(findings: Finding[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = RANK[failOn] ?? 1;
  return findings.some((f) => (RANK[f.severity] ?? 3) <= threshold);
}

/** Agent transcripts on this machine: summary per agent, each secret once with how often it appears. */
function runAgentHistory(args: CliArgs, rawArgs: string[]): never {
  // Off unless asked for: transcripts are full of code the agent read
  const entropy = rawArgs.includes("--entropy");
  const result = scanAgentHistory({ ...(args.home ? { home: args.home } : {}), entropy });
  let findings = result.findings;
  if (args.baseline) findings = applyBaseline(findings, readBaseline(args.baseline)).findings as typeof findings;
  if (args.writeBaseline) {
    writeBaseline(args.writeBaseline, findings);
    process.exit(0);
  }
  if (args.format === "json") {
    console.log(JSON.stringify({ sources: result.sources, findings, scannedFiles: result.scannedFiles, durationMs: result.durationMs }, null, 2));
  } else if (args.format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), findings), null, 2));
  } else {
    if (result.sources.length === 0) console.log("No agent history found (Claude Code, Codex, Gemini CLI, Continue).");
    for (const source of result.sources) console.log(`   ${source.agent.padEnd(12)} ${source.path} (${source.files} file(s))`);
    console.log("");
    printText(findings, result.scannedFiles, result.durationMs, "agent history file(s)");
    if (findings.length > 0) {
      console.log("A secret in an agent transcript was already sent to the model provider: rotate it, then delete the transcript.");
      for (const f of findings) if (f.occurrences > 1) console.log(`   ${f.patternName} (${f.match}) appears ${f.occurrences} times`);
    }
  }
  process.exit(shouldFail(findings, args.failOn) ? 1 : 0);
}

async function runCli(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  if (args.agentHistory) runAgentHistory(args, rawArgs);
  const gitMode = args.staged ? "staged" : args.history !== undefined ? "history" : null;
  const target = args.positionals[0] ?? (gitMode ? "." : undefined);
  if (!target) {
    console.error("Usage: guardbee-secret-scanner scan <path> [--staged | --history[=<range>]] [--baseline=<file>] [--fail-on=any] [--format=text|json|sarif]");
    process.exit(2);
  }

  // Load guardbee.yml config, CLI flags override
  const cfg = loadConfig(target, {
    ...(args.failOn !== "any" ? { failOn: args.failOn } : {}),
    ...(args.maxFiles !== 5000 ? { maxFiles: args.maxFiles } : {}),
  });
  const cfgPath = configFilePath(target);
  if (cfgPath && args.format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

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
  let scope = "file(s)";

  if (gitMode) {
    try {
      const result = await scanGit({
        cwd: stat.isDirectory() ? target : dirname(target),
        mode: gitMode,
        ...(args.history ? { range: args.history } : {}),
        ...(args.maxCommits ? { maxCommits: args.maxCommits } : {}),
        entropy: args.entropy,
      });
      findings = result.findings;
      scannedFiles = gitMode === "history" ? result.scannedCommits : result.scannedHunks;
      scope = gitMode === "history" ? "commit(s)" : "staged hunk(s)";
      durationMs = result.durationMs;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  } else if (stat.isDirectory()) {
    const result = scanDirectory(target, { maxFiles, exclude: cfg.exclude, entropy: args.entropy });
    findings = result.findings;
    scannedFiles = result.scannedFiles;
    durationMs = result.durationMs;
  } else {
    const start = Date.now();
    const result = scanFile(target, target, { entropy: args.entropy });
    findings = result.findings;
    scannedFiles = result.skipped ? 0 : 1;
    durationMs = Date.now() - start;
  }

  // Apply allowlist from config
  if (cfg.allowlist.length > 0) {
    findings = findings.filter((f) => !cfg.allowlist.some((a) => f.match.includes(a) || f.context.includes(a)));
  }

  if (args.writeBaseline) {
    const written = writeBaseline(args.writeBaseline, findings);
    process.stderr.write(`[guardbee] Wrote ${written.findings.length} finding(s) to baseline ${args.writeBaseline}\n`);
    process.exit(0);
  }
  if (args.baseline) {
    try {
      const applied = applyBaseline(findings, readBaseline(args.baseline));
      findings = applied.findings;
      if (applied.suppressed > 0 && args.format === "text") {
        process.stderr.write(`[guardbee] ${applied.suppressed} known finding(s) hidden by baseline ${args.baseline}\n`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  }

  if (args.format === "json") {
    console.log(JSON.stringify({ findings, scannedFiles, durationMs }, null, 2));
  } else if (args.format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), findings), null, 2));
  } else {
    printText(findings, scannedFiles, durationMs, scope);
  }

  process.exit(shouldFail(findings, failOn) ? 1 : 0);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-secret-scanner

Usage (MCP server):
  guardbee-secret-scanner [serve]

Usage (CLI):
  guardbee-secret-scanner scan <path>              Scan a file or directory for secrets
  guardbee-secret-scanner scan [repo] --staged     Scan only lines added in the git index (pre-commit)
  guardbee-secret-scanner scan [repo] --history    Scan lines added by every commit (all refs)
  guardbee-secret-scanner scan --agent-history     Scan coding agents' transcripts on this machine
                                                   (Claude Code, Codex, Gemini CLI, Continue)

Options:
  --fail-on=<level>        Exit 1 if secrets at this severity or above are found
                           Levels: any (default) | critical | high | medium | low | none
  --format=<fmt>           Output format: text (default) | json | sarif
  --max-files=<n>          Max files to scan (default: 5000)
  --history=<range>        Limit history to a revision range, e.g. main..HEAD
  --max-commits=<n>        Stop after n commits (history)
  --write-baseline=<file>  Record current findings (hashes, never secrets) and exit 0
  --baseline=<file>        Report only findings not in the baseline
  --no-entropy             Skip the high-entropy check (random values assigned to secret-like names)
  --entropy                With --agent-history: also run the high-entropy check (off there by default)
  --home=<dir>             With --agent-history: look under this folder instead of your home

Exit codes:
  0  No secrets found (or none above --fail-on threshold)
  1  Secrets found at or above threshold
  2  Error / bad arguments
`);
}

// ── Entry point ────────────────────────────────────────────────────────────────

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-secret-scanner] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
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
