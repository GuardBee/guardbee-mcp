#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { verifyAuditChain } from "./audit/logger.js";
import { loadGatewayConfig } from "./gateway/config.js";
import { clientConfigPath, runInit, type ClientName } from "./init.js";
import { startGateway } from "./proxy.js";
import { PinStore, defaultPinFile } from "./gateway/pin-store.js";
import { connectUpstream } from "./gateway/upstream.js";
import { buildReport, signReport, verifyReport } from "./report/report.js";
import { extractSigned, renderHtml, renderMarkdown, type Lang } from "./report/render.js";

const CLIENTS: ClientName[] = ["claude-desktop", "cursor", "claude-code"];

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function verifyAudit(filePath: string | undefined): void {
  if (!filePath) throw new Error("Usage: guardbee-proxy verify-audit <audit.jsonl>");
  const result = verifyAuditChain(fs.readFileSync(filePath, "utf8"));
  if (result.ok) {
    process.stdout.write(`OK: ${result.events} events, hash chain intact\n`);
    return;
  }
  process.stdout.write(`BROKEN at line ${result.line}: ${result.reason}\n`);
  process.exit(1);
}

function init(args: string[]): void {
  const client = flag(args, "--client") as ClientName | undefined;
  const file = flag(args, "--file");
  if ((!client && !file) || (client && !CLIENTS.includes(client))) {
    throw new Error(
      `Usage: guardbee-proxy init (--client ${CLIENTS.join("|")} | --file <mcp.json>) [--out <guardbee-proxy.yaml>] [--dry-run] [--force]`
    );
  }
  const dryRun = args.includes("--dry-run");
  const result = runInit({
    clientConfigPath: file ?? clientConfigPath(client!),
    yamlPath: flag(args, "--out") ?? path.join(os.homedir(), ".guardbee", "guardbee-proxy.yaml"),
    dryRun,
    force: args.includes("--force"),
  });

  const out = process.stdout;
  for (const [key, name] of Object.entries(result.migrated)) out.write(`  moved   ${key} → upstream "${name}"\n`);
  for (const { name, reason } of result.kept) out.write(`  kept    ${name} (${reason})\n`);
  if (dryRun) {
    out.write(`\n--- guardbee-proxy.yaml ---\n${result.yaml}\n--- client config ---\n${result.clientConfig}`);
    return;
  }
  out.write(`\nWrote the proxy config and pointed the client at it. Backup: ${result.backupPath}\n`);
  if (client === "claude-code" && !file) {
    out.write("Claude Code rewrites ~/.claude.json while it runs: quit it before init, or check the file afterwards.\n");
  }
  out.write("Restart the client to load the proxy.\n");
}

function parseDate(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name}: not a date (${value}); use e.g. 2026-10-01 or 2026-10-01T00:00:00Z`);
  return date;
}

/** guardbee-proxy report <audit.jsonl> [--days 30 | --from … --to …] [--format md|html|json] [--lang en|tr] [--key ed25519.pem] [--out file] */
function report(args: string[]): void {
  const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!file) {
    throw new Error("Usage: guardbee-proxy report <audit.jsonl> [--days 30 | --from 2026-10-01 --to 2026-11-01] [--format md|html|json] [--lang en|tr] [--key ed25519.pem] [--out report.html]");
  }
  const to = flag(args, "--to") ? parseDate(flag(args, "--to")!, "--to") : new Date();
  const from = flag(args, "--from") ? parseDate(flag(args, "--from")!, "--from") : new Date(to.getTime() - Number(flag(args, "--days") ?? 30) * 86_400_000);
  const format = flag(args, "--format") ?? (flag(args, "--out")?.endsWith(".html") ? "html" : flag(args, "--out")?.endsWith(".json") ? "json" : "md");
  const lang = (flag(args, "--lang") ?? "en") as Lang;
  if (!["md", "html", "json"].includes(format)) throw new Error("--format is md, html or json");
  if (!["en", "tr"].includes(lang)) throw new Error("--lang is en or tr");
  const keyFile = flag(args, "--key");
  const signed = signReport(buildReport(fs.readFileSync(file, "utf8"), { from, to, file: path.basename(file) }), keyFile ? fs.readFileSync(keyFile, "utf8") : undefined);
  const output = format === "json" ? JSON.stringify(signed, null, 2) + "\n" : format === "html" ? renderHtml(signed, lang) : renderMarkdown(signed, lang);
  const out = flag(args, "--out");
  if (out) {
    fs.writeFileSync(out, output);
    process.stdout.write(`Wrote ${out} (SHA-256 ${signed.signature.sha256}${signed.signature.value ? ", Ed25519-signed" : ", not signed"})\n`);
  } else {
    process.stdout.write(output);
  }
  if (!signed.report.source.chain.ok) process.stderr.write(`[guardbee-proxy] warning: the audit log's hash chain is ${signed.report.source.chain.detail}\n`);
}

function verifyReportCommand(args: string[]): void {
  const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!file) throw new Error("Usage: guardbee-proxy verify-report <report.json|.html|.md> [--pubkey ed25519.pub.pem]");
  const pub = flag(args, "--pubkey");
  const check = verifyReport(extractSigned(fs.readFileSync(file, "utf8")), pub ? fs.readFileSync(pub, "utf8") : undefined);
  if (check.ok) {
    process.stdout.write(check.signed ? `OK: signature valid${pub ? " (trusted key)" : " (embedded key)"}, report unchanged\n` : "OK: report unchanged (not signed)\n");
    return;
  }
  process.stdout.write(`FAILED: ${check.reason}\n`);
  process.exit(1);
}

function version(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

const PINS_USAGE = `Usage:
  guardbee-proxy pins list [--config <file>]
  guardbee-proxy pins approve <upstream> [tool] [--config <file>]   Trust the server's current definitions
  guardbee-proxy pins reset [upstream] [tool] [--config <file>]     Forget pins (trusted again on first use)
  guardbee-proxy pins import <baseline.json> --upstream <name>      Seed from an mcp-rug-pull-detector baseline`;

/** The pins file the gateway would use with this config. */
function pinStore(): PinStore {
  let file: string | undefined;
  try {
    file = loadGatewayConfig().pins?.file;
  } catch {
    // No config: the default file
  }
  return new PinStore(file ?? defaultPinFile());
}

async function pins(args: string[]): Promise<void> {
  const positional = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const [action, first, second] = positional;
  if (action === "list") {
    const store = pinStore();
    const upstreams = Object.entries(store.upstreams());
    if (upstreams.length === 0) process.stdout.write(`No pins in ${store.file}\n`);
    for (const [name, entry] of upstreams) {
      process.stdout.write(`${name}${entry.serverInfo ? ` (${entry.serverInfo.name} ${entry.serverInfo.version})` : ""}\n`);
      for (const [tool, pin] of Object.entries(entry.tools)) process.stdout.write(`  ${tool}  ${pin.hash.slice(0, 12)}  since ${pin.firstSeen}\n`);
    }
    return;
  }
  if (action === "approve" && first) {
    const config = loadGatewayConfig();
    const server = config.upstreams[first];
    if (!server) throw new Error(`No upstream "${first}" in the config (${Object.keys(config.upstreams).join(", ") || "none"})`);
    const upstream = await connectUpstream(first, server);
    try {
      const listed = (await upstream.listTools()).filter((tool) => !second || tool.name === second);
      if (second && listed.length === 0) throw new Error(`"${first}" has no tool "${second}"`);
      const store = new PinStore(config.pins?.file ?? defaultPinFile());
      store.approve(first, listed);
      process.stdout.write(`Pinned ${listed.length} tool definition(s) of ${first} in ${store.file}\n`);
    } finally {
      await upstream.close();
    }
    return;
  }
  if (action === "reset") {
    const store = pinStore();
    const count = store.reset(first, second);
    process.stdout.write(`Removed ${count} pin entr${count === 1 ? "y" : "ies"} from ${store.file}\n`);
    return;
  }
  if (action === "import" && first) {
    const upstream = flag(args, "--upstream");
    if (!upstream) throw new Error("pins import needs --upstream <name>: the baseline does not know the proxy's name for the server");
    const store = pinStore();
    const count = store.importBaseline(upstream, JSON.parse(fs.readFileSync(first, "utf8")));
    process.stdout.write(`Imported ${count} tool definition(s) for ${upstream} into ${store.file}\n`);
    return;
  }
  throw new Error(PINS_USAGE);
}

const HELP = `guardbee-proxy: MCP security gateway

Usage:
  guardbee-proxy [--config <guardbee-proxy.yaml>]   Run the gateway (stdio, or HTTP when listen is set)
  guardbee-proxy -- <command> [args...]            Single-server mode: wrap one stdio MCP server
  guardbee-proxy init (--client ${CLIENTS.join("|")} | --file <mcp.json>) [--out <file>] [--dry-run] [--force]
                                                   Move a client's MCP servers behind the gateway
  guardbee-proxy validate [--config <file>]        Check a config without starting anything
  guardbee-proxy verify-audit <audit.jsonl>        Check an audit log's hash chain
  guardbee-proxy pins list | approve <upstream> [tool] | reset [upstream] [tool] | import <baseline.json> --upstream <name>
                                                   Tool definitions pinned across restarts
  guardbee-proxy report <audit.jsonl> [--days 30 | --from <date> --to <date>] [--format md|html|json]
                 [--lang en|tr] [--key ed25519.pem] [--out <file>]
                                                   Signed OWASP / MITRE ATLAS report from an audit log
  guardbee-proxy verify-report <report> [--pubkey ed25519.pub.pem]
                                                   Check a report's signature
  guardbee-proxy --help | --version

Config: --config, else GUARDBEE_PROXY_CONFIG, else ./guardbee-proxy.yaml (.yml); with none, the -- form or PROXY_COMMAND.
Docs and examples: https://github.com/GuardBee/guardbee-mcp/tree/main/packages/security-proxy#readme
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${version()}\n`);
    return;
  }
  if (command === "verify-audit") return verifyAudit(rest[0]);
  if (command === "pins") return pins(rest);
  if (command === "init") return init(rest);
  if (command === "report") return report(rest);
  if (command === "verify-report") return verifyReportCommand(rest);
  if (command === "validate") {
    const config = loadGatewayConfig();
    process.stdout.write(`OK: ${Object.keys(config.upstreams).length} upstream(s), ${config.rules.length} rule(s), taint.mode=${config.taint.mode}\n`);
    return;
  }
  await startGateway(loadGatewayConfig());
}

main().catch((err) => {
  process.stderr.write(
    `[guardbee-proxy] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
