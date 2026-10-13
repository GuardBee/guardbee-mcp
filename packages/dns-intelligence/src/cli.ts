#!/usr/bin/env node
import { startServer } from "./server.js";
import { enumerateDomain, enumerateSubdomainsDetailed, formatDnsReport, formatSubdomainReport } from "./dns.js";
import { normalizeDomain } from "./resolver.js";
import type { Finding } from "./dns.js";
import { buildSarif } from "./sarif.js";
import { loadConfig } from "./config.js";
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

// ── Severity helpers ───────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function meetsThreshold(sev: string, threshold: string): boolean {
  return (SEVERITY_RANK[sev] ?? 4) <= (SEVERITY_RANK[threshold] ?? 1);
}

function hasFailingFindings(findings: Finding[], failOn: string): boolean {
  return findings.some((f) => meetsThreshold(f.severity, failOn));
}

// ── Arg parsing ────────────────────────────────────────────────────────────────

interface CliArgs {
  positionals: string[];
  format: string;
  /** Undefined when not given, so guardbee.yml keeps its value. */
  failOn?: string;
  concurrency?: number;
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = { positionals: [], format: "text" };
  for (const arg of args) {
    const value = arg.slice(arg.indexOf("=") + 1);
    if (arg.startsWith("--fail-on=")) out.failOn = value;
    else if (arg.startsWith("--format=")) out.format = value;
    else if (arg.startsWith("--concurrency=")) out.concurrency = Number.parseInt(value, 10);
    else if (!arg.startsWith("--")) out.positionals.push(arg);
  }
  if (out.failOn !== undefined && !(out.failOn in SEVERITY_RANK)) {
    throw new Error(`--fail-on must be critical, high, medium, low or info, got "${out.failOn}"`);
  }
  if (out.concurrency !== undefined && !(out.concurrency >= 1 && out.concurrency <= 200)) {
    throw new Error(`--concurrency must be between 1 and 200`);
  }
  return out;
}

// ── CLI commands ───────────────────────────────────────────────────────────────

async function runCheck(rawArgs: string[]): Promise<void> {
  const parsed = parseArgs(rawArgs);
  const cfg = loadConfig(process.cwd(), {
    ...(parsed.failOn !== undefined ? { failOn: parsed.failOn } : {}),
  });
  const domainArg = parsed.positionals[0] ?? cfg.domains[0];
  const { failOn, format } = { failOn: cfg.failOn, format: parsed.format };

  if (!domainArg) {
    console.error("Usage: guardbee-dns-intelligence check <domain> [--fail-on=high] [--format=text|json|sarif]");
    console.error("       Or set domains in guardbee.yml under dns-intelligence.domains");
    process.exit(2);
  }
  const domain = normalizeDomain(domainArg);

  const result = await enumerateDomain(domain);

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), domain, result.findings), null, 2));
  } else {
    console.log(formatDnsReport(result));
  }

  // Not process.exit(): it can drop the tail of a large report written to a pipe.
  process.exitCode = hasFailingFindings(result.findings, failOn) ? 1 : 0;
}

async function runSubdomains(rawArgs: string[]): Promise<void> {
  const parsed = parseArgs(rawArgs);
  const cfg = loadConfig(process.cwd(), {
    ...(parsed.concurrency !== undefined ? { concurrency: parsed.concurrency } : {}),
  });
  const domainArg = parsed.positionals[0] ?? cfg.domains[0];
  const { format, concurrency } = { format: parsed.format, concurrency: cfg.concurrency };

  if (!domainArg) {
    console.error("Usage: guardbee-dns-intelligence subdomains <domain> [--format=text|json] [--concurrency=20]");
    console.error("       Or set domains in guardbee.yml under dns-intelligence.domains");
    process.exit(2);
  }
  const domain = normalizeDomain(domainArg);

  const { results, wildcard } = await enumerateSubdomainsDetailed(domain, concurrency);
  const dangling = results.filter((r) => r.dangling);

  if (format === "json") {
    console.log(JSON.stringify({ domain, total: results.length, dangling: dangling.length, wildcard: wildcard ?? null, results }, null, 2));
  } else {
    console.log(formatSubdomainReport(domain, results, wildcard));
  }

  process.exitCode = dangling.length > 0 ? 1 : 0;
}

function printHelp(): void {
  console.log(`@guardbee/mcp-dns-intelligence

Usage (MCP server):
  guardbee-dns-intelligence [serve]

Usage (CLI):
  guardbee-dns-intelligence check <domain>       Full DNS check (records + SPF/DMARC/DKIM)
  guardbee-dns-intelligence subdomains <domain>  Enumerate subdomains, detect dangling CNAMEs

Options:
  --fail-on=<level>     Exit 1 if findings at this severity or above (default: high)
                        Levels: critical | high | medium | low | info
  --format=<fmt>        Output format: text (default) | json | sarif (check only)
  --concurrency=<n>     Parallel subdomain probes (default: 20, subdomains only)

Exit codes:
  0  No issues at or above --fail-on threshold (check) / no dangling subdomains (subdomains)
  1  Issues found (check) or dangling subdomains detected (subdomains)
  2  Error / bad arguments

Examples:
  guardbee-dns-intelligence check example.com
  guardbee-dns-intelligence check example.com --fail-on=medium --format=json
  guardbee-dns-intelligence subdomains example.com --concurrency=50
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
} else if (firstArg === "check") {
  runCheck(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "subdomains") {
  runSubdomains(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
