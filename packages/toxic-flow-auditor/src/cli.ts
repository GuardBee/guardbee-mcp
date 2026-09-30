#!/usr/bin/env node
import { startServer } from "./server.js";
import { auditCatalog, parseToolsJson } from "./analyzer.js";
import { scanDirectory, scanSourceFile } from "./scanner.js";
import { buildSarif } from "./sarif.js";
import { readFileSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion(): string {
  try {
    return (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`@guardbee/mcp-toxic-flow-auditor

Usage (MCP server):
  guardbee-toxic-flow-auditor [serve]

Usage (CLI):
  guardbee-toxic-flow-auditor audit <tools.json>   Audit a tools/list JSON dump
  guardbee-toxic-flow-auditor scan <path>          Scan source file or directory

Options:
  --format=text|json|sarif   Output format (default: text)
  --fail-on=any|critical|high|medium|none
`);
}

function parseArgs(args: string[]) {
  const positionals: string[] = [];
  let format = "text";
  let failOn = "any";
  for (const arg of args) {
    if (arg.startsWith("--format=")) format = arg.split("=")[1] ?? "text";
    else if (arg.startsWith("--fail-on=")) failOn = arg.split("=")[1] ?? "any";
    else if (!arg.startsWith("--")) positionals.push(arg);
  }
  return { positionals, format, failOn };
}

function shouldFail(findings: { severity: string }[], failOn: string): boolean {
  if (failOn === "none") return false;
  if (failOn === "any") return findings.length > 0;
  const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  const threshold = RANK[failOn] ?? 1;
  return findings.some((f) => (RANK[f.severity] ?? 3) <= threshold);
}

async function runAudit(path: string, format: string, failOn: string): Promise<void> {
  const tools = parseToolsJson(readFileSync(path, "utf8"));
  const result = auditCatalog(tools, path);
  emit(result, format, failOn);
}

async function runScan(path: string, format: string, failOn: string): Promise<void> {
  const stat = statSync(path);
  const result = stat.isDirectory() ? scanDirectory(path) : scanSourceFile(path).result;
  emit(result, format, failOn);
}

function emit(
  result: Awaited<ReturnType<typeof auditCatalog>>,
  format: string,
  failOn: string
): void {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === "sarif") {
    console.log(JSON.stringify(buildSarif(getVersion(), result.findings), null, 2));
  } else {
    console.log(`Grade ${result.grade} (${result.score}/100) — ${result.toolCount} tools, ${result.durationMs}ms`);
    console.log(`  untrusted : ${result.byCapability["untrusted-content"].join(", ") || "—"}`);
    console.log(`  sensitive : ${result.byCapability["sensitive-data"].join(", ") || "—"}`);
    console.log(`  exfil     : ${result.byCapability.exfiltration.join(", ") || "—"}`);
    console.log(`  destruct  : ${result.byCapability.destructive.join(", ") || "—"}`);
    console.log("");
    if (result.findings.length === 0) {
      console.log("✅ No toxic-flow findings");
    } else {
      for (const f of result.findings) {
        console.log(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.owasp})`);
        console.log(`  tools: ${f.tools.join(", ")}`);
        console.log(`  fix  : ${f.recommendation}`);
        console.log("");
      }
    }
  }
  process.exit(shouldFail(result.findings, failOn) ? 1 : 0);
}

const [, , firstArg, ...rest] = process.argv;

if (!firstArg || firstArg === "serve") {
  startServer().catch((err) => {
    process.stderr.write(`[guardbee-toxic-flow-auditor] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (firstArg === "--help" || firstArg === "-h") {
  printHelp();
} else if (firstArg === "audit") {
  const { positionals, format, failOn } = parseArgs(rest);
  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-toxic-flow-auditor audit <tools.json>");
    process.exit(2);
  }
  runAudit(target, format, failOn).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else if (firstArg === "scan") {
  const { positionals, format, failOn } = parseArgs(rest);
  const target = positionals[0];
  if (!target) {
    console.error("Usage: guardbee-toxic-flow-auditor scan <path>");
    process.exit(2);
  }
  runScan(target, format, failOn).catch((err) => {
    console.error("Error:", (err as Error).message);
    process.exit(2);
  });
} else {
  console.error(`Unknown command: ${firstArg}`);
  printHelp();
  process.exit(2);
}
