#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { startStdioServer } from "./server";

const HELP = `guardbee-gateway: KVKK/GDPR gateway between an LLM and your database (MCP server, stdio)

Usage:
  guardbee-gateway              Start the MCP server on stdio (an MCP client runs this)
  guardbee-gateway --help | --version

Environment:
  DATABASE_URL          Database to serve; without it the server runs on built-in demo data
  GATEWAY_ROLE          Active role for role-based access rules
  GATEWAY_SERVER_NAME   Server name shown to the client
  GATEWAY_PII_SCAN      1/true, or a preset (KVKK, SECRETS, ...): also mask PII in text fields no rule covers

Field and table rules, write access and adapters (pg, mysql2, better-sqlite3, mongodb, Prisma) are set
in code with createServer(); see https://github.com/GuardBee/guardbee-mcp/tree/main/packages/db-gateway#readme
`;

const arg = process.argv[2];
if (arg === "--help" || arg === "-h" || arg === "help") {
  process.stdout.write(HELP);
} else if (arg === "--version" || arg === "-v") {
  try {
    process.stdout.write(`${(JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string }).version}\n`);
  } catch {
    process.stdout.write("unknown\n");
  }
} else if (arg !== undefined) {
  process.stderr.write(`[guardbee-gateway] Unknown argument: ${arg}\n\n${HELP}`);
  process.exit(2);
} else {
  startStdioServer().catch((err) => {
    console.error("[guardbee-gateway] Fatal error:", err);
    process.exit(1);
  });
}
