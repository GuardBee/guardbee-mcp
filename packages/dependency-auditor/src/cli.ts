#!/usr/bin/env node
import { startServer } from "./server.js";
import { parseNpmManifest, type Dependency } from "./parsers/npm.js";
import { parsePipRequirements } from "./parsers/pip.js";
import { queryOsvBatch, getSeverity, getFixedVersion, isMalicious, type Ecosystem } from "./osv.js";
import { formatReport } from "./report.js";
import type { AuditResult } from "./osv.js";
import { buildSarif } from "./sarif.js";
import { loadConfig, configFilePath, type DependencyAuditorConfig } from "./config.js";
import { enrichExploitability } from "./exploit.js";
import { gateExitCode } from "./gate.js";
import { auditDependencies } from "./audit.js";
import { parseOtherEcosystems } from "./parsers/other-locks.js";
import { planUpgrade } from "./fix.js";
import { readFileSync } from "fs";
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

/** JSON output: raw OSV records plus the verdict the CLI acted on. */
function annotate(results: AuditResult[]): unknown[] {
  return results.map((r) => ({
    ...r,
    ...(r.vulns.length > 0 ? { guardbee: { upgrade: planUpgrade(r) } } : {}),
    vulns: r.vulns.map(({ exploit, ...v }) => ({
      ...v,
      guardbee: {
        severity: getSeverity(v),
        malicious: isMalicious(v),
        fixedVersion: getFixedVersion(v, r.name, r.version, r.ecosystem),
        kev: exploit?.kev ?? null,
        epss: exploit?.epss ?? null,
      },
    })),
  }));
}

// ── CLI ────────────────────────────────────────────────────────────────────────

/** `[guardbee] npm: pnpm-lock.yaml (4 packages)` — shows whether versions are exact. */
function reportSource(label: string, deps: Dependency[], format: string): void {
  if (format !== "text" || deps.length === 0) return;
  const files = [...new Set(deps.map((d) => d.file ?? "manifest"))].join(", ");
  process.stderr.write(`[guardbee] ${label}: ${files} (${deps.length} packages)\n`);
}

interface CliArgs {
  positionals: string[];
  format: string;
  failOn?: string;
  failOnKev?: boolean;
  failOnEpss?: number;
  includeDev?: boolean;
  exploitData?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = { positionals: [], format: "text" };
  for (const arg of args) {
    const value = arg.slice(arg.indexOf("=") + 1);
    if (arg.startsWith("--fail-on=")) out.failOn = value;
    else if (arg === "--fail-on-kev") out.failOnKev = true;
    else if (arg.startsWith("--fail-on-epss=")) out.failOnEpss = Number(value);
    else if (arg.startsWith("--format=")) out.format = value;
    else if (arg === "--include-dev") out.includeDev = true;
    else if (arg === "--no-exploit-data") out.exploitData = false;
    else if (!arg.startsWith("--")) out.positionals.push(arg);
  }
  return out;
}

/** Explicit CLI flags win over guardbee.yml; unset flags leave the file's value. */
function overrides(args: CliArgs): Partial<DependencyAuditorConfig> {
  const o: Partial<DependencyAuditorConfig> = {};
  if (args.failOn !== undefined) o.failOn = args.failOn;
  if (args.failOnKev !== undefined) o.failOnKev = args.failOnKev;
  if (args.failOnEpss !== undefined) o.failOnEpss = args.failOnEpss;
  if (args.includeDev !== undefined) o.includeDev = args.includeDev;
  if (args.exploitData !== undefined) o.exploitData = args.exploitData;
  return o;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function collect(cmd: string, dir: string, cfg: DependencyAuditorConfig, format: string): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  if (cmd !== "audit-pip") {
    let deps = parseNpmManifest(dir);
    if (!cfg.includeDev) deps = deps.filter((d) => !d.isDev);
    reportSource("npm", deps, format);
    if (deps.length > 0) {
      results.push(...(await auditDependencies(deps, "npm")));
    }
  }

  if (cmd !== "audit-npm") {
    let deps = parsePipRequirements(dir);
    if (!cfg.includeDev) deps = deps.filter((d) => !d.isDev);
    reportSource("pip", deps, format);
    if (deps.length > 0) {
      results.push(...(await auditDependencies(deps, "PyPI")));
    }
  }

  if (cmd === "audit") {
    for (const { ecosystem, label, deps: found } of parseOtherEcosystems(dir)) {
      const deps = cfg.includeDev ? found : found.filter((d) => !d.isDev);
      reportSource(label, deps, format);
      if (deps.length > 0) results.push(...(await auditDependencies(deps, ecosystem)));
    }
  }

  return results;
}

async function runCli(cmd: string, rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  const { positionals, format } = args;
  const start = Date.now();

  let results: AuditResult[];
  let cfg: DependencyAuditorConfig;
  let label: string;

  if (cmd === "audit-pkg") {
    const [name, version, ecosystem] = positionals;
    const ecosystems: Ecosystem[] = ["npm", "PyPI", "crates.io", "Maven", "Go", "RubyGems", "Packagist"];
    if (!name || !version || !ecosystem || !ecosystems.includes(ecosystem as Ecosystem)) {
      fail(`Usage: guardbee-dependency-auditor audit-pkg <name> <version> <ecosystem>\n  ecosystems: ${ecosystems.join(", ")}`);
    }
    cfg = loadConfig(null, overrides(args));
    results = await queryOsvBatch([{ name, version, ecosystem: ecosystem as Ecosystem }]);
    label = ecosystem;
  } else {
    const dir = positionals[0];
    if (!dir) {
      fail(`Usage: guardbee-dependency-auditor ${cmd} <directory> [--fail-on=high] [--include-dev] [--format=text|json|sarif]`);
    }
    cfg = loadConfig(dir, overrides(args));
    const cfgPath = configFilePath(dir);
    if (cfgPath && format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

    results = await collect(cmd, dir, cfg, format);
    if (results.length === 0) fail(`No supported manifest files found in: ${dir}`);
    label = cmd === "audit-npm" ? "npm" : cmd === "audit-pip" ? "pip" : "total";

    if (cfg.ignore.length > 0) {
      for (const r of results) {
        r.vulns = r.vulns.filter((v) => !cfg.ignore.some((id) => v.id === id || (v.aliases ?? []).includes(id)));
      }
    }
  }

  const notes: string[] = [];
  if (cfg.exploitData) {
    const unavailable = await enrichExploitability(results);
    if (unavailable.length > 0) {
      // A gate on missing data would silently pass: fail instead.
      if ((cfg.failOnKev && unavailable.includes("CISA KEV")) || (cfg.failOnEpss !== null && unavailable.includes("FIRST EPSS"))) {
        fail(`Could not fetch ${unavailable.join(" and ")} data required by --fail-on-kev / --fail-on-epss.`);
      }
      notes.push(`ℹ️  Exploit data unavailable from ${unavailable.join(" and ")}; findings are ordered by severity only.`);
    }
  } else if (cfg.failOnKev || cfg.failOnEpss !== null) {
    fail("--fail-on-kev / --fail-on-epss need exploit data; remove --no-exploit-data.");
  }

  if (format === "json") {
    console.log(JSON.stringify({ results: annotate(results), durationMs: Date.now() - start }, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), results), null, 2));
  } else {
    console.log(formatReport(results, label, Date.now() - start, notes));
  }

  // Not process.exit(): it can drop the tail of a large report written to a pipe.
  process.exitCode = gateExitCode(results, cfg);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-dependency-auditor

Usage (MCP server):
  guardbee-dependency-auditor [serve]

Usage (CLI):
  guardbee-dependency-auditor audit <dir>      Auto-detect npm, pip, Cargo, Go, Ruby and Composer projects
  guardbee-dependency-auditor audit-npm <dir>  Audit npm only
  guardbee-dependency-auditor audit-pip <dir>  Audit pip only
  guardbee-dependency-auditor audit-pkg <name> <version> <ecosystem>

Options:
  --fail-on=<level>   Exit 1 if findings at this severity or above (default: high)
                      Levels: critical | high | medium | low | none
  --fail-on-kev       Exit 1 if a finding is exploited in the wild (CISA KEV)
  --fail-on-epss=<p>  Exit 1 if a finding's EPSS score is at least p (0–1)
  --no-exploit-data   Do not fetch CISA KEV / FIRST EPSS data (only CVE IDs are sent)
  --include-dev       Include dev dependencies (npm devDependencies, Poetry/uv/Pipenv dev groups)
  --format=<fmt>      Output format: text (default) | json | sarif

Exit codes:
  0  No findings at or above --fail-on threshold
  1  Findings found at or above threshold
  2  Error / bad arguments
`);
}

// ── Entry point ────────────────────────────────────────────────────────────────

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
} else if (["audit", "audit-npm", "audit-pip", "audit-pkg"].includes(firstArg)) {
  runCli(firstArg, rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
