import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanText, scanDirectory } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("missing tool audit", () => {
  it("yakalar: McpServer + tool var, audit yok", () => {
    const code = `
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
const server = new McpServer({ name: "demo", version: "1.0.0" });
server.tool("echo", "Echo", {}, async ({ text }) => ({ content: [{ type: "text", text }] }));
`;
    expect(idsOf(code)).toContain("mcp_server_without_tool_audit");
  });

  it("audit/telemetry varken missing-audit üretmez", () => {
    const code = `
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
const server = new McpServer({ name: "demo", version: "1.0.0" });
instrumentServer(server, "demo");
server.tool("echo", "Echo", {}, async () => ({ content: [] }));
`;
    expect(idsOf(code)).not.toContain("mcp_server_without_tool_audit");
  });

  it("tool kaydı olmayan dosyada missing-audit üretmez", () => {
    const code = `const server = new McpServer({ name: "x", version: "1" });`;
    expect(idsOf(code)).not.toContain("mcp_server_without_tool_audit");
  });
});

describe("unsafe logging", () => {
  it("yakalar: tool args console.log", () => {
    const code = `
const server = new McpServer({ name: "x", version: "1" });
server.tool("run", "Run", {}, async (args) => {
  console.log(args);
  return { content: [] };
});
`;
    expect(idsOf(code)).toContain("raw_tool_args_logged");
  });

  it("yakalar: tool result logger.info", () => {
    const code = `
server.tool("run", "Run", {}, async () => {
  const result = await doWork();
  logger.info(result);
  return result;
});
`;
    expect(idsOf(code)).toContain("raw_tool_result_logged");
  });

  it("MCP dışı dosyada args log'u işaretlemez", () => {
    const code = `function handle(args) { console.log(args); }`;
    expect(idsOf(code)).not.toContain("raw_tool_args_logged");
  });
});

describe("disabled audit", () => {
  it("yakalar: audit: false", () => {
    expect(idsOf(`export const cfg = { audit: false };`)).toContain("audit_disabled_in_code");
  });

  it("yakalar: GUARDBEE_TELEMETRY=0", () => {
    expect(idsOf(`process.env.GUARDBEE_TELEMETRY=0`)).toContain("audit_disabled_in_code");
  });
});

describe("silent failure", () => {
  it("yakalar: boş catch tool handler yanında", () => {
    const code = `
server.tool("x", "x", {}, async () => {
  try { await work(); } catch (e) {}
});
`;
    expect(idsOf(code)).toContain("tool_error_swallowed_silently");
  });

  it("log'lu catch'i işaretlemez", () => {
    const code = `
server.tool("x", "x", {}, async () => {
  try { await work(); } catch (e) { console.error(e); }
});
`;
    expect(idsOf(code)).not.toContain("tool_error_swallowed_silently");
  });
});

describe("correlation id", () => {
  it("yakalar: audit.log nesnesinde session/request yok", () => {
    const code = `
const server = new McpServer({ name: "x", version: "1" });
server.tool("t", "t", {}, async () => {
  audit.log({ tool: "t", outcome: "ok" });
  return { content: [] };
});
`;
    expect(idsOf(code)).toContain("audit_log_without_correlation_id");
  });

  it("sessionId varken işaretlemez", () => {
    const code = `
const server = new McpServer({ name: "x", version: "1" });
server.tool("t", "t", {}, async () => {
  audit.log({ tool: "t", sessionId: sid, outcome: "ok" });
  return { content: [] };
});
`;
    expect(idsOf(code)).not.toContain("audit_log_without_correlation_id");
  });
});

describe("directory scan", () => {
  it("dizindeki bulguları toplar", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-gap-"));
    try {
      writeFileSync(
        join(dir, "server.ts"),
        `
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
const server = new McpServer({ name: "demo", version: "1.0.0" });
server.tool("echo", "Echo", {}, async (args) => {
  console.log(args);
  return { content: [] };
});
`
      );
      const result = scanDirectory(dir);
      expect(result.scannedFiles).toBe(1);
      expect(result.findings.map((f) => f.patternId)).toEqual(
        expect.arrayContaining(["mcp_server_without_tool_audit", "raw_tool_args_logged"])
      );
      expect(result.findings.every((f) => f.owasp === "MCP08:2025")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
