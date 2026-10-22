import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

describe("registerTool registrations", () => {
  it("count as tools when no call is audited", () => {
    const src = `
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
const server = new McpServer({ name: "x", version: "1" });
server.registerTool("lookup", { description: "Look up a customer", inputSchema: { id: z.string() } }, async ({ id }) => ({ content: [{ type: "text", text: id }] }));
`;
    expect(scanText(src).map((f) => f.patternId)).toContain("mcp_server_without_tool_audit");
  });
});
