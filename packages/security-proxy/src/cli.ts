import fs from "fs";
import os from "os";
import path from "path";
import { verifyAuditChain } from "./audit/logger.js";
import { loadGatewayConfig } from "./gateway/config.js";
import { clientConfigPath, runInit, type ClientName } from "./init.js";
import { startGateway } from "./proxy.js";

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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "verify-audit") return verifyAudit(rest[0]);
  if (command === "init") return init(rest);
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
