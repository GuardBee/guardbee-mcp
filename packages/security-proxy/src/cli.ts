import fs from "fs";
import { verifyAuditChain } from "./audit/logger.js";
import { loadGatewayConfig } from "./gateway/config.js";
import { startGateway } from "./proxy.js";

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

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === "verify-audit") return verifyAudit(arg);
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
