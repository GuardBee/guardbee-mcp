import { describe, expect, it } from "vitest";
import type { McpIndex } from "@guardbee/guard-core";
import { formatGrades, gradeFindings, gradeServer } from "../grades.js";
import { parseMcpConfig } from "../parseConfig.js";

const index: McpIndex = {
  format: 1,
  rubricVersion: "2026-11",
  generatedAt: "2026-11-01T00:00:00Z",
  servers: [
    { name: "io.github.a/good", version: "1", packages: [{ ecosystem: "npm", identifier: "good-mcp", version: "2.0.0" }], remote: false, grade: "A", score: 95, reasons: [], scannedAt: "2026-11-01T00:00:00Z" },
    { name: "io.github.b/risky", version: "1", packages: [{ ecosystem: "pypi", identifier: "risky-mcp", version: "0.3.0" }], remote: false, grade: "F", score: 0, reasons: [], scannedAt: "2026-11-01T00:00:00Z" },
    { name: "io.github.c/meh", version: "1", packages: [{ ecosystem: "npm", identifier: "@c/meh" }], remote: false, grade: "C", score: 74, reasons: [], scannedAt: "2026-11-01T00:00:00Z" },
  ],
};

const { servers } = parseMcpConfig(
  JSON.stringify({
    mcpServers: {
      good: { command: "npx", args: ["-y", "good-mcp@2.0.0"] },
      risky: { command: "uvx", args: ["risky_mcp"] },
      meh: { command: "npx", args: ["@c/meh"] },
      local: { command: "node", args: ["./server.js"] },
      remote: { url: "https://mcp.example.com/mcp" },
      unknown: { command: "npx", args: ["-y", "not-in-index"] },
    },
  }),
);

describe("MCP Index grades for configured servers", () => {
  const grades = servers.map((s) => gradeServer(index, s, "mcp.json"));

  it("grades registry packages and says why the others have no grade", () => {
    expect(grades.map((g) => [g.server, g.grade, g.note])).toEqual([
      ["good", "A", "graded good-mcp@2.0.0"],
      ["risky", "F", "graded risky-mcp@0.3.0 (the config runs the latest version)"],
      ["meh", "C", "graded @c/meh@? (the config runs the latest version)"],
      ["local", null, "local command: not a registry package"],
      ["remote", null, "remote server: the index grades published packages"],
      ["unknown", null, "not in the MCP Index (not in the official registry)"],
    ]);
  });

  it("reports servers below --min-grade, F as critical", () => {
    const findings = gradeFindings(grades, "B");
    expect(findings.map((f) => [f.server, f.severity, f.owasp])).toEqual([
      ["risky", "critical", "MCP04:2025"],
      ["meh", "high", "MCP04:2025"],
    ]);
    expect(findings[0]!.recommendation).toContain("io.github.b/risky F (0/100)");
    expect(gradeFindings(grades, "F")).toEqual([]);
  });

  it("prints a grade table", () => {
    expect(formatGrades(grades).split("\n")[1]).toMatch(/^ {2}A {2}good +npm:good-mcp@2\.0\.0 {2}graded good-mcp@2\.0\.0$/);
  });
});
