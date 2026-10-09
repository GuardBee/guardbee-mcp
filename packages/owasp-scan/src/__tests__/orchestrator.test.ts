import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanPath, scanCatalogJson } from "../orchestrator.js";
import { gradeFromFindings } from "../grade.js";
import { resolveOwasp } from "../owaspMap.js";

describe("resolveOwasp", () => {
  it("honors explicit tags", () => {
    expect(resolveOwasp("MCP05:2025", "x", "mcp-server-auditor")).toBe("MCP05:2025");
  });

  it("maps secret-scanner to MCP01", () => {
    expect(resolveOwasp(undefined, "aws_access_key", "secret-scanner")).toBe("MCP01:2025");
  });
});

describe("gradeFromFindings", () => {
  it("grades lethal trifecta as F", () => {
    expect(
      gradeFromFindings([
        {
          patternId: "lethal_trifecta",
          patternName: "x",
          severity: "critical",
          owasp: "MCP10:2025",
          source: "toxic-flow",
          recommendation: "",
          match: "",
        },
      ]).grade
    ).toBe("F");
  });

  it("grades clean as A", () => {
    expect(gradeFromFindings([]).grade).toBe("A");
  });
});

describe("scanCatalogJson", () => {
  it("detects lethal trifecta in a catalog", () => {
    const report = scanCatalogJson(
      JSON.stringify({
        tools: [
          { name: "fetch_url", description: "Fetch arbitrary web pages" },
          { name: "read_vault_secret", description: "Read customer vault secrets" },
          { name: "send_email", description: "Send email to any address" },
        ],
      })
    );
    expect(report.grade).toBe("F");
    expect(report.findings.some((f) => f.patternId === "lethal_trifecta")).toBe(true);
    expect(report.byOwasp.find((b) => b.id === "MCP10:2025")?.findingCount).toBeGreaterThan(0);
  });
});

describe("scanPath", () => {
  it("flags MCP05 shell sink and MCP08 audit gap in a sample server", () => {
    const dir = mkdtempSync(join(tmpdir(), "owasp-scan-"));
    try {
      writeFileSync(
        join(dir, "server.ts"),
        `
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execSync } from "child_process";
const server = new McpServer({ name: "demo", version: "1.0.0" });
server.tool("run", "Run", {}, async (input) => {
  execSync(input.command);
  return { content: [] };
});
`
      );
      const report = scanPath(dir);
      expect(report.findings.some((f) => f.owasp === "MCP05:2025")).toBe(true);
      expect(report.findings.some((f) => f.owasp === "MCP08:2025")).toBe(true);
      expect(report.grade).not.toBe("A");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
