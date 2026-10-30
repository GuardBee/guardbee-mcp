#!/usr/bin/env node
/**
 * @guardbee/security-suite — one install, every GuardBee MCP security tool.
 *
 * MCP mode:  guardbee serve [--tools=<groups,ids>]  → one MCP server with the selected packages' tools
 *            (also with no arguments when stdin is not a terminal, as an MCP client starts it)
 * CLI mode:  guardbee <package-id> <args>            → that package's own CLI
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { GROUPS, PACKAGES, selectPackages } from "./catalog.js";

function getVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return (JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** The shortcuts the suite had before it covered every package; each runs one command. */
const ALIASES: Record<string, { id: string; cmd: string }> = {
  "secret-scan": { id: "secret-scanner", cmd: "scan" },
  "dep-audit": { id: "dependency-auditor", cmd: "audit" },
  "ssl-inspect": { id: "ssl-inspector", cmd: "inspect" },
  "dns-check": { id: "dns-intelligence", cmd: "check" },
};

/** A package's own CLI: its package.json `bin`, found next to its main entry. */
function resolveCli(pkgName: string): string {
  // import.meta.resolve: the packages are ESM with an `import`-only exports map
  const mainPath = fileURLToPath(import.meta.resolve(pkgName));
  let dir = dirname(mainPath);
  while (!existsSync(resolve(dir, "package.json"))) dir = dirname(dir);
  const manifest = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
  const bin = typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0];
  const cli = resolve(dir, bin ?? "dist/cli.js");
  if (!existsSync(cli)) throw new Error(`Cannot find the CLI of ${pkgName} (tried ${cli})`);
  return cli;
}

function runCli(id: string, args: string[]): never {
  const entry = PACKAGES.find((p) => p.id === id)!;
  const result = spawnSync(process.execPath, [resolveCli(entry.pkg), ...args], { stdio: "inherit", env: process.env });
  process.exit(result.status ?? 1);
}

async function runServe(args: string[]): Promise<void> {
  const spec = args.find((a) => a.startsWith("--tools="))?.slice("--tools=".length) ?? process.env["GUARDBEE_SUITE_TOOLS"] ?? "recommended";
  const packages = selectPackages(spec);
  const { buildSuiteServer } = await import("./serve.js");
  const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
  process.stderr.write(`[guardbee] serving ${packages.map((p) => p.id).join(", ")}\n`);
  serveStdio(() => buildSuiteServer(packages, getVersion()));
}

function printList(): void {
  const lines = ["Packages (use the id as a CLI command or in --tools):", ""];
  const width = Math.max(...PACKAGES.map((p) => p.id.length));
  for (const p of PACKAGES) lines.push(`  ${p.id.padEnd(width)}  ${p.summary}  [${p.groups.join(", ")}]`);
  lines.push("", "Groups:", "");
  for (const [name, summary] of Object.entries(GROUPS)) lines.push(`  ${name.padEnd(13)} ${summary}`);
  lines.push(`  ${"all".padEnd(13)} Every package above`);
  console.log(lines.join("\n"));
}

function printHelp(): void {
  console.log(`@guardbee/security-suite ${getVersion()}

Usage (MCP server):
  guardbee serve                         The recommended tools (${selectPackages().map((p) => p.id).join(", ")})
  guardbee serve --tools=code,network    Groups and package ids, comma-separated; or --tools=all
                                         (also GUARDBEE_SUITE_TOOLS=...)
  Tool names carry their package's prefix: secrets_scan_text, injection_scan_file, owasp_scan_path, ...

Usage (CLI):
  guardbee list                          Every package, its group and what it checks
  guardbee <package-id> <args>           Run that package's CLI, e.g.
    guardbee owasp-scan scan . --fail-on=high --format=sarif
    guardbee secret-scanner scan . --history
    guardbee mcp-config-auditor discover

Shortcuts:
  guardbee secret-scan <path>            = secret-scanner scan
  guardbee dep-audit <dir>               = dependency-auditor audit
  guardbee ssl-inspect <domain>...       = ssl-inspector inspect
  guardbee dns-check <domain>            = dns-intelligence check
`);
}

const [, , command, ...rest] = process.argv;

// An MCP client starts the server with no arguments (and a pipe, not a terminal, on stdin)
const serveByDefault = !command && !process.stdin.isTTY;

if (serveByDefault || command === "serve") {
  runServe(rest).catch((err) => {
    console.error("Fatal:", (err as Error).message);
    process.exit(1);
  });
} else if (!command || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "--version" || command === "-v") {
  console.log(getVersion());
} else if (command === "list") {
  printList();
} else if (ALIASES[command]) {
  runCli(ALIASES[command].id, [ALIASES[command].cmd, ...rest]);
} else if (PACKAGES.some((p) => p.id === command)) {
  runCli(command, rest);
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(2);
}
