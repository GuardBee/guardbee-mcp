#!/usr/bin/env node
import { startServer } from "./server.js";
import { enumerateDomain, enumerateSubdomainsDetailed, formatDnsReport, formatSubdomainReport, TAKEOVER_LABEL } from "./dns.js";
import { normalizeDomain, systemResolver } from "./resolver.js";
import { checkTakeover } from "./takeover.js";
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
  http?: boolean;
  ct?: boolean;
  nsProbe?: boolean;
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
    else if (arg === "--no-http") out.http = false;
    else if (arg === "--no-ct") out.ct = false;
    else if (arg === "--no-ns-probe") out.nsProbe = false;
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

  const result = await enumerateDomain(domain, { nsProbe: parsed.nsProbe, http: parsed.http });

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

  const { results, wildcard, ct } = await enumerateSubdomainsDetailed(domain, concurrency, {
    http: parsed.http,
    ct: parsed.ct !== false,
  });
  const dangling = results.filter((r) => r.dangling);

  if (format === "json") {
    console.log(
      JSON.stringify({ domain, total: results.length, dangling: dangling.length, wildcard: wildcard ?? null, ct: ct ?? null, results }, null, 2)
    );
  } else {
    console.log(formatSubdomainReport(domain, results, wildcard, ct));
  }

  process.exitCode = dangling.length > 0 || (wildcard?.takeover && wildcard.takeover.risk !== "stale") ? 1 : 0;
}

async function runTakeover(rawArgs: string[]): Promise<void> {
  const parsed = parseArgs(rawArgs);
  if (parsed.positionals.length === 0) {
    console.error("Usage: guardbee-dns-intelligence takeover <host> [host…] [--no-http] [--format=text|json]");
    process.exit(2);
  }
  const hosts = parsed.positionals.map(normalizeDomain);
  const results = await Promise.all(
    hosts.map(async (host) => ({ host, takeover: await checkTakeover(host, systemResolver, { http: parsed.http }) }))
  );
  if (parsed.format === "json") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const { host, takeover } of results) {
      if (!takeover) console.log(`✅  ${host}  no takeover indicators`);
      else {
        console.log(`⚠️  ${host}  ${takeover.provider} (${TAKEOVER_LABEL[takeover.risk]})`);
        console.log(`      └─ ${takeover.evidence}`);
        console.log(`      └─ CNAME chain: ${[host, ...takeover.chain].join(" → ")}`);
      }
    }
  }
  process.exitCode = results.some((x) => x.takeover && x.takeover.risk !== "stale") ? 1 : 0;
}

function printHelp(): void {
  console.log(`@guardbee/mcp-dns-intelligence

Usage (MCP server):
  guardbee-dns-intelligence [serve]

Usage (CLI):
  guardbee-dns-intelligence check <domain>       Full DNS check (records + SPF/DMARC/DKIM)
  guardbee-dns-intelligence subdomains <domain>  Find subdomains (CT logs + wordlist), detect takeovers
  guardbee-dns-intelligence takeover <host…>     Check given hostnames for subdomain takeover

Options:
  --fail-on=<level>     Exit 1 if findings at this severity or above (default: high)
                        Levels: critical | high | medium | low | info
  --format=<fmt>        Output format: text (default) | json | sarif (check only)
  --concurrency=<n>     Parallel subdomain probes (default: 20, subdomains only)
  --no-http             Skip HTTP fingerprinting; only DNS-based takeover checks run
  --no-ct               Skip Certificate Transparency (crt.sh, Cert Spotter); wordlist only
  --no-ns-probe         Do not query nameservers directly (AXFR, lame delegation, open resolver)

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
} else if (firstArg === "takeover") {
  runTakeover(rest).catch((err) => {
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
