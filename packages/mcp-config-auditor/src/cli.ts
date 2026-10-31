#!/usr/bin/env node
import { readFileSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { configFilePath, loadConfig } from "./config.js";
import { buildSarif } from "./sarif.js";
import { discoverHostMcp, loadAllowlistFile, scanConfigFile, scanDirectory, scanInventory } from "./scanner.js";
import { buildInventory, uploadInventory } from "./inventory.js";
import { isMcpGrade, type McpGrade } from "@guardbee/guard-core";
import { formatGrades, gradeFindings, gradeServer, loadIndexForGrades, type ServerGrade } from "./grades.js";
import { parseMcpConfig } from "./parseConfig.js";
import type { ConfigFinding, InventoryServer, ParsedServer } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const SEV_ICON: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };

function printText(findings: ConfigFinding[], scannedFiles: number, durationMs: number): void {
  if (findings.length === 0) {
    console.log(`✅ No MCP config issues found in ${scannedFiles} file(s) (${durationMs}ms)`);
    return;
  }
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  console.log(`⚠️  Found ${findings.length} issue(s) in ${scannedFiles} file(s) (${durationMs}ms)`);
  console.log(
    `   Critical: ${counts.critical ?? 0}  High: ${counts.high ?? 0}  Medium: ${counts.medium ?? 0}  Low: ${counts.low ?? 0}`
  );
  console.log("");
  for (const finding of findings) {
    console.log(`${SEV_ICON[finding.severity] ?? "⚪"} [${finding.severity.toUpperCase()}] ${finding.patternName} (${finding.owasp})`);
    if (finding.server) console.log(`   Server         : ${finding.server}`);
    if (finding.file) console.log(`   File           : ${finding.file}:${finding.line}:${finding.column}`);
    console.log(`   Match          : ${finding.match}`);
    console.log(`   Recommendation : ${finding.recommendation}`);
    console.log("");
  }
}

function shouldFail(findings: ConfigFinding[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const threshold = rank[failOn] ?? 1;
  return findings.some((finding) => (rank[finding.severity] ?? 3) <= threshold);
}

function parseArgs(args: string[]): {
  positionals: string[];
  failOn: string;
  format: string;
  maxFiles: number;
  allowlist?: string;
  home?: string;
  includeContentAudit: boolean;
  upload: boolean;
  uploadUrl?: string;
  includeUser: boolean;
  grades: boolean;
  minGrade?: McpGrade;
  indexUrl?: string;
  offline: boolean;
} {
  const positionals: string[] = [];
  let grades = false;
  let minGrade: McpGrade | undefined;
  let indexUrl: string | undefined;
  let offline = false;
  let failOn = "any";
  let format = "text";
  let maxFiles = 5000;
  let allowlist: string | undefined;
  let home: string | undefined;
  let includeContentAudit = false;
  let upload = false;
  let uploadUrl: string | undefined;
  let includeUser = true;
  for (const arg of args) {
    if (arg.startsWith("--fail-on=")) failOn = arg.split("=")[1] ?? "any";
    else if (arg.startsWith("--format=")) format = arg.split("=")[1] ?? "text";
    else if (arg.startsWith("--max-files=")) maxFiles = parseInt(arg.split("=")[1] ?? "5000", 10);
    else if (arg.startsWith("--allowlist=")) allowlist = arg.slice("--allowlist=".length);
    else if (arg.startsWith("--home=")) home = arg.slice("--home=".length);
    else if (arg === "--include-content-audit") includeContentAudit = true;
    else if (arg === "--upload") upload = true;
    else if (arg.startsWith("--upload-url=")) {
      upload = true;
      uploadUrl = arg.slice("--upload-url=".length);
    } else if (arg === "--no-user") includeUser = false;
    else if (arg === "--grades") grades = true;
    else if (arg.startsWith("--min-grade=")) {
      const value = arg.slice("--min-grade=".length).toUpperCase();
      if (!isMcpGrade(value)) {
        console.error(`--min-grade takes A, B, C, D or F (got ${value})`);
        process.exit(2);
      }
      minGrade = value;
      grades = true;
    } else if (arg.startsWith("--index-url=")) indexUrl = arg.slice("--index-url=".length);
    else if (arg === "--offline") offline = true;
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  return {
    positionals,
    failOn,
    format,
    maxFiles,
    allowlist,
    home,
    includeContentAudit,
    upload,
    ...(uploadUrl ? { uploadUrl } : {}),
    includeUser,
    grades,
    ...(minGrade ? { minGrade } : {}),
    ...(indexUrl ? { indexUrl } : {}),
    offline,
  };
}

type GradeArgs = Pick<ReturnType<typeof parseArgs>, "grades" | "minGrade" | "indexUrl" | "offline">;

/** MCP Index grades for these servers (when --grades / --min-grade): printed in text mode, findings below the minimum. */
async function gradeStep(servers: Array<{ server: ParsedServer; file?: string }>, args: GradeArgs, format: string): Promise<{ grades: ServerGrade[]; findings: ConfigFinding[] }> {
  if (!args.grades) return { grades: [], findings: [] };
  let index;
  try {
    index = await loadIndexForGrades({ ...(args.indexUrl ? { url: args.indexUrl } : {}), offline: args.offline });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const grades = servers.map(({ server, file }) => gradeServer(index, server, file));
  if (format === "text") console.log(`${formatGrades(grades)}\n`);
  return { grades, findings: args.minGrade ? gradeFindings(grades, args.minGrade) : [] };
}

function emit(findings: ConfigFinding[], scannedFiles: number, durationMs: number, format: string, failOn: string, grades?: ServerGrade[]): void {
  if (format === "json") console.log(JSON.stringify({ findings, scannedFiles, durationMs, ...(grades?.length ? { grades } : {}) }, null, 2));
  else if (format === "sarif") console.log(JSON.stringify(buildSarif(getVersion(), findings), null, 2));
  else printText(findings, scannedFiles, durationMs);
  process.exit(shouldFail(findings, failOn) ? 1 : 0);
}

async function runScan(rawArgs: string[]): Promise<void> {
  const parsedArgs = parseArgs(rawArgs);
  const { positionals, failOn: cliFail, format, maxFiles: cliMax } = parsedArgs;
  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-mcp-config-auditor scan <file-or-dir> [--fail-on=any] [--format=text|json|sarif]");
    process.exit(2);
  }
  const cfg = loadConfig(target, {
    ...(cliFail !== "any" ? { failOn: cliFail } : {}),
    ...(cliMax !== 5000 ? { maxFiles: cliMax } : {}),
  });
  const cfgPath = configFilePath(target);
  if (cfgPath && format === "text") process.stderr.write(`[guardbee] Using config: ${cfgPath}\n`);

  let stat;
  try {
    stat = statSync(target);
  } catch {
    console.error(`Path not found: ${target}`);
    process.exit(2);
  }

  if (stat.isDirectory()) {
    if (parsedArgs.grades) console.error("--grades / --min-grade apply to a config file or to discover, not to a directory scan");
    const result = scanDirectory(target, { maxFiles: cfg.maxFiles, exclude: cfg.exclude });
    emit(result.findings, result.scannedFiles, result.durationMs, format, cfg.failOn);
    return;
  }
  const start = Date.now();
  const result = scanConfigFile(target);
  const graded = await gradeStep(parseMcpConfig(readFileSync(target, "utf8")).servers.map((server) => ({ server, file: target })), parsedArgs, format);
  emit([...result.findings, ...graded.findings], result.skipped ? 0 : 1, Date.now() - start, format, cfg.failOn, graded.grades);
}

function runInventory(rawArgs: string[]): void {
  const { positionals, failOn, format } = parseArgs(rawArgs);
  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-mcp-config-auditor inventory <file.json> [--format=text|json|sarif]");
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (err) {
    console.error(`Cannot read inventory: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const servers = Array.isArray((parsed as { servers?: unknown }).servers)
    ? ((parsed as { servers: InventoryServer[] }).servers)
    : null;
  if (!servers) {
    console.error('Inventory JSON must be { "servers": [{ "name": "...", "tools": [{ "name": "...", "description": "..." }] }] }');
    process.exit(2);
  }
  const findings = scanInventory(servers, target);
  emit(findings, 1, 0, format, failOn);
}

async function runDiscover(rawArgs: string[]): Promise<void> {
  const parsedArgs = parseArgs(rawArgs);
  const { failOn, format, allowlist: allowlistPath, home, includeContentAudit, upload, uploadUrl, includeUser } = parsedArgs;
  let allowlist = null;
  if (allowlistPath) {
    try {
      allowlist = loadAllowlistFile(allowlistPath);
    } catch (err) {
      console.error(`Cannot read allowlist: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  }
  const result = discoverHostMcp({ home, allowlist, includeContentAudit });
  const inventory = buildInventory(result, { includeUser });

  if (upload) {
    const apiKey = process.env["GUARDBEE_API_KEY"];
    if (!apiKey) {
      console.error("--upload needs GUARDBEE_API_KEY (a workspace API key with the gateway.write scope)");
      process.exit(2);
    }
    const sent = await uploadInventory(inventory, { apiKey, ...(uploadUrl ? { url: uploadUrl } : {}) });
    const line = sent.ok ? `Uploaded the inventory (${inventory.servers.length} server(s)) to the GuardBee dashboard.` : `Upload failed: HTTP ${sent.status} ${sent.message}`;
    process.stderr.write(line + "\n");
    if (!sent.ok) process.exitCode = 2;
  }

  if (format === "text") console.log(`Discovered ${result.scannedFiles} config(s); ${result.missingPaths} well-known path(s) absent.`);
  const graded = await gradeStep(
    result.discovered.flatMap((d) => d.servers.map((server) => ({ server, file: d.path }))),
    parsedArgs,
    format,
  );
  const findings = [...result.findings, ...graded.findings];
  if (format === "json") {
    console.log(
      JSON.stringify(
        { findings, scannedFiles: result.scannedFiles, missingPaths: result.missingPaths, durationMs: result.durationMs, inventory, ...(parsedArgs.grades ? { grades: graded.grades } : {}) },
        null,
        2
      )
    );
    process.exit(process.exitCode ?? (shouldFail(findings, failOn) ? 1 : 0));
    return;
  }
  if (format === "text") {
    for (const server of inventory.servers) {
      const what = server.package ? `${server.package.name}@${server.package.version ?? "latest"}` : (server.url ?? server.command ?? "?");
      const env = server.envKeys.length ? ` env: ${server.envKeys.join(", ")}` : "";
      console.log(`  ${server.client.padEnd(14)} ${server.name.padEnd(24)} ${server.transport.padEnd(5)} ${what}${env}`);
    }
    console.log("");
  }
  emit(findings, result.scannedFiles, result.durationMs, format, failOn);
}

function printHelp(): void {
  console.log(`@guardbee/mcp-config-auditor

Usage (MCP server):
  guardbee-mcp-config-auditor [serve]

Usage (CLI):
  guardbee-mcp-config-auditor scan <file-or-dir>   Audit MCP client configs and SKILL.md files
  guardbee-mcp-config-auditor inventory <file.json>  Cross-server tool shadowing
  guardbee-mcp-config-auditor discover             OWASP MCP09 shadow MCP host discovery

A directory scan reads mcp.json, mcp_config.json, claude_desktop_config.json, and SKILL.md.
An explicit file path is scanned even when the name differs. A file named SKILL.md is audited as an agent skill.
Skill name collisions are reported on a directory scan.

discover walks well-known Cursor / Claude / Windsurf / VS Code paths and compares
installed servers to an organization allowlist.

Options:
  --fail-on=<level>   any (default) | critical | high | medium | low | none
  --format=<fmt>      text (default) | json | sarif
  --max-files=<n>     Max files to scan (default: 5000)
  --allowlist=<file>  Allowlist JSON or line file (discover)
  --home=<dir>        Override home for well-known paths (discover)
  --include-content-audit  Also run content checks on discovered configs (discover)
  --upload            Send the inventory to the GuardBee dashboard (GUARDBEE_API_KEY, scope gateway.write)
  --upload-url=<url>  Another dashboard endpoint (implies --upload)
  --no-user           Leave the OS user name out of the inventory
  --grades            Show each server's GuardBee MCP Index grade (scan <file>, discover); downloads the
                      whole index (cached a day), so no server name leaves the machine
  --min-grade=<A-F>   Also report servers graded below this (implies --grades)
  --index-url=<url>   Another index (default https://guardbee.github.io/guardbee-mcp/index/v1.json)
  --offline           Use the cached index only
`);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  const { startServer } = await import("./server.js");
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-mcp-config-auditor] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
  process.exit(0);
} else if (firstArg === "scan") {
  runScan(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "inventory") {
  try {
    runInventory(rest);
  } catch (err) {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  }
} else if (firstArg === "discover") {
  runDiscover(rest).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else {
  console.error(`Unknown command: ${firstArg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}
