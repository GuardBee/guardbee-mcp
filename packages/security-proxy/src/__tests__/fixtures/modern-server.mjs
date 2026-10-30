// A stdio MCP server on SDK v2: serves 2026-07-28 and falls back to 2025-11-25.
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

serveStdio(() => {
  const server = new Server({ name: "modern", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler("tools/list", async () => ({ tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] }));
  server.setRequestHandler("tools/call", async (req) => ({ content: [{ type: "text", text: JSON.stringify(req.params.arguments ?? {}) }] }));
  return server;
});
