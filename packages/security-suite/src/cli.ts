#!/usr/bin/env node
/**
 * @guardbee/security-suite — unified CLI for all GuardBee security tools.
 *
 * MCP mode:  guardbee serve          → combined MCP server (all tools)
 * CLI mode:  guardbee <tool> <args>  → delegates to the specific tool's CLI
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";

// ── Tool → package mapping ─────────────────────────────────────────────────────

const TOOL_MAP: Record<string, { pkg: string; cmd: string }> = {
  "secret-scan":  { pkg: "@guardbee/mcp-secret-scanner",    cmd: "scan"    },
  "dep-audit":    { pkg: "@guardbee/mcp-dependency-auditor", cmd: "audit"   },
  "ssl-inspect":  { pkg: "@guardbee/mcp-ssl-inspector",      cmd: "inspect" },
  "dns-check":    { pkg: "@guardbee/mcp-dns-intelligence",   cmd: "check"   },
};

// ── Resolve a package's dist/cli.js via import.meta.resolve ───────────────────

async function resolveCliJs(pkgName: string): Promise<string> {
  // Resolve the main export of the package, then find dist/cli.js relative to it
  const mainUrl = await import.meta.resolve(pkgName);
  const mainPath = fileURLToPath(mainUrl);
  const pkgDir = dirname(dirname(mainPath)); // mainPath = <pkg>/dist/index.js → up twice
  const cliPath = resolve(pkgDir, "dist", "cli.js");
  if (existsSync(cliPath)) return cliPath;
  // Fallback: maybe dist is one level up
  const cliPath2 = resolve(dirname(mainPath), "cli.js");
  if (existsSync(cliPath2)) return cliPath2;
  throw new Error(`Cannot find cli.js for ${pkgName} (tried ${cliPath})`);
}

// ── CLI delegation ─────────────────────────────────────────────────────────────

async function runTool(tool: string, args: string[]): Promise<never> {
  const entry = TOOL_MAP[tool];
  if (!entry) {
    console.error(`Unknown tool: ${tool}`);
    printHelp();
    process.exit(2);
  }

  const cliPath = await resolveCliJs(entry.pkg);
  const result = spawnSync(process.execPath, [cliPath, entry.cmd, ...args], {
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

// ── MCP server (combined) ─────────────────────────────────────────────────────

async function runServe(): Promise<void> {
  // Start all 4 tools as a combined MCP server by re-exporting their tools
  // into a single McpServer instance.
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { instrumentServer } = await import("@guardbee/mcp-telemetry");
  const { z } = await import("zod");

  // Import core functions from each tool
  const { scanDirectory, scanFile } = await import("@guardbee/mcp-secret-scanner") as any;
  const { parseNpmManifest } = await import("@guardbee/mcp-dependency-auditor") as any;
  const { parsePipRequirements } = await import("@guardbee/mcp-dependency-auditor") as any;
  const { queryOsvBatch } = await import("@guardbee/mcp-dependency-auditor") as any;
  const { inspectHost, checkHsts } = await import("@guardbee/mcp-ssl-inspector") as any;
  const { enumerateDomain, enumerateSubdomains } = await import("@guardbee/mcp-dns-intelligence") as any;

  const server = new McpServer({ name: "guardbee-security-suite", version: "0.1.0" });
  instrumentServer(server, "security-suite");

  // ── Secret Scanner tools ────────────────────────────────────────────────────
  server.tool("scan_directory", "Scan a directory for exposed secrets, API keys, and credentials",
    { directory: z.string(), maxFiles: z.number().optional() },
    async ({ directory, maxFiles = 5000 }: { directory: string; maxFiles?: number }) => {
      const result = scanDirectory(directory, { maxFiles });
      const counts: Record<string, number> = {};
      for (const f of result.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      const summary = result.findings.length === 0
        ? `✅ No secrets found in ${result.scannedFiles} files`
        : `⚠️ Found ${result.findings.length} secrets — Critical:${counts["critical"]??0} High:${counts["high"]??0} Medium:${counts["medium"]??0}`;
      return { content: [{ type: "text", text: summary + "\n\n" + JSON.stringify(result.findings.slice(0, 20), null, 2) }] };
    });

  server.tool("scan_file", "Scan a single file for secrets",
    { filePath: z.string() },
    async ({ filePath }: { filePath: string }) => {
      const result = scanFile(filePath);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });

  // ── Dependency Auditor tools ────────────────────────────────────────────────
  server.tool("audit_dependencies", "Audit npm/pip dependencies for known CVEs",
    { directory: z.string() },
    async ({ directory }: { directory: string }) => {
      const lines: string[] = [];
      const npmDeps = parseNpmManifest(directory).filter((d: any) => !d.isDev);
      if (npmDeps.length > 0) {
        const results = await queryOsvBatch(npmDeps.map((d: any) => ({ name: d.name, version: d.version, ecosystem: "npm" })));
        const vuln = results.filter((r: any) => r.vulns.length > 0);
        lines.push(`npm: ${vuln.length}/${results.length} vulnerable packages`);
      }
      const pipDeps = parsePipRequirements(directory);
      if (pipDeps.length > 0) {
        const results = await queryOsvBatch(pipDeps.map((d: any) => ({ name: d.name, version: d.version, ecosystem: "PyPI" })));
        const vuln = results.filter((r: any) => r.vulns.length > 0);
        lines.push(`pip: ${vuln.length}/${results.length} vulnerable packages`);
      }
      return { content: [{ type: "text", text: lines.join("\n") || "No manifests found" }] };
    });

  // ── SSL Inspector tools ─────────────────────────────────────────────────────
  server.tool("inspect_ssl", "Inspect TLS certificate, cipher suite, and HSTS for a domain",
    { host: z.string(), port: z.number().optional() },
    async ({ host, port = 443 }: { host: string; port?: number }) => {
      const result = await inspectHost(host, port);
      const hsts = await checkHsts(host, port);
      result.supportsHsts = hsts.enabled;
      const issues = result.findings.filter((f: any) => f.code !== "OK");
      const summary = issues.length === 0
        ? `✅ ${host} — no SSL issues`
        : `⚠️ ${host} — ${issues.length} issue(s): ${issues.map((f: any) => f.code).join(", ")}`;
      return { content: [{ type: "text", text: summary }] };
    });

  // ── DNS Intelligence tools ──────────────────────────────────────────────────
  server.tool("check_dns", "Enumerate DNS records and check SPF/DMARC/DKIM configuration",
    { domain: z.string() },
    async ({ domain }: { domain: string }) => {
      const result = await enumerateDomain(domain);
      const issues = result.findings.filter((f: any) => f.severity === "high" || f.severity === "critical");
      const summary = issues.length === 0
        ? `✅ ${domain} — no critical DNS issues`
        : `⚠️ ${domain} — ${issues.length} high/critical issue(s)`;
      return { content: [{ type: "text", text: summary + "\n\n" + JSON.stringify(result.findings, null, 2) }] };
    });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ── Help ───────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`@guardbee/security-suite

Usage (MCP server — all tools combined):
  guardbee serve

Usage (CLI — direct tool invocation):
  guardbee secret-scan <path>           Scan for exposed secrets
  guardbee dep-audit <dir>              Audit npm/pip for CVEs
  guardbee ssl-inspect <domain>...      TLS certificate inspection
  guardbee dns-check <domain>           DNS/SPF/DMARC/dangling check

Each command supports:
  --fail-on=<level>        critical | high | medium | low (| any for secrets)
  --format=text|json|sarif

Examples:
  guardbee secret-scan . --fail-on=high --format=sarif > secrets.sarif
  guardbee dep-audit . --fail-on=critical
  guardbee ssl-inspect example.com api.example.com
  guardbee dns-check example.com --fail-on=medium
`);
}

// ── Entry point ────────────────────────────────────────────────────────────────

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
} else if (firstArg === "serve") {
  runServe().catch((err) => {
    console.error("Fatal:", (err as Error).message);
    process.exit(1);
  });
} else if (TOOL_MAP[firstArg]) {
  runTool(firstArg, rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else {
  console.error(`Unknown command: ${firstArg}`);
  printHelp();
  process.exit(2);
}
