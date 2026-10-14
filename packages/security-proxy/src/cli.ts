#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { verifyAuditChain } from "./audit/logger.js";
import { loadGatewayConfig } from "./gateway/config.js";
import { clientConfigPath, runInit, type ClientName } from "./init.js";
import { startGateway } from "./proxy.js";
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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "verify-audit") return verifyAudit(rest[0]);
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
