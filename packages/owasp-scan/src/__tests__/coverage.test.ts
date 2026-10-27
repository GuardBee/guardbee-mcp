import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanPath } from "../orchestrator.js";

const dir = mkdtempSync(join(tmpdir(), "owasp-coverage-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

mkdirSync(join(dir, "py"));
mkdirSync(join(dir, "go"));
mkdirSync(join(dir, "node_modules"));
writeFileSync(
  join(dir, "py/server.py"),
  `import subprocess
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("x")

@mcp.tool()
def disk_usage(directory: str) -> str:
    """Disk usage."""
    return subprocess.run(f"du -sh {directory}", shell=True).stdout

@mcp.tool()
def hello(name: str) -> str:
    """Say hello."""
    return "hi " + name
`,
);
writeFileSync(
  join(dir, "go/main.go"),
  `package main
func main() {
	s.AddTool(mcp.NewTool("ping", mcp.WithDescription("Ping")), ping)
}
func ping(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	host, _ := request.RequireString("host")
	out, _ := exec.Command("sh", "-c", "ping -c 1 "+host).Output()
	return mcp.NewToolResultText(string(out)), nil
}
`,
);
writeFileSync(join(dir, "lib.rs"), "fn main() {}\n");
writeFileSync(join(dir, "index.ts"), 'server.tool("echo", "Echo", {}, async () => ({ content: [] }));\n');
writeFileSync(join(dir, "README.md"), "# x\n");
writeFileSync(join(dir, "node_modules/dep.js"), "module.exports = 1;\n");

describe("language coverage", () => {
  const report = scanPath(dir);

  it("lists every source file with its language, depth and tool count", () => {
    expect(report.coverage!.files).toEqual([
      { file: "go/main.go", language: "go", analysis: "full", tools: 1 },
      { file: "index.ts", language: "typescript", analysis: "full", tools: 1 },
      { file: "lib.rs", language: "rust", analysis: "patterns", tools: 0 },
      { file: "py/server.py", language: "python", analysis: "full", tools: 2 },
    ]);
  });

  it("summarizes per language", () => {
    expect(report.coverage!.languages.map((l) => `${l.language}:${l.files}:${l.tools}:${l.analysis}`)).toEqual([
      "go:1:1:full",
      "python:1:2:full",
      "rust:1:0:patterns",
      "typescript:1:1:full",
    ]);
  });

  it("reports Python and Go tool-input flows under MCP05", () => {
    const mcp05 = report.findings.filter((f) => f.owasp === "MCP05:2025").map((f) => `${f.patternId} ${f.file?.replace(dir, "")}`);
    expect(mcp05).toEqual(expect.arrayContaining(["python_shell_from_tool_input /py/server.py", "go_shell_from_tool_input /go/main.go"]));
  });

  it("covers a single file scan", () => {
    const single = scanPath(join(dir, "py/server.py"));
    expect(single.coverage!.files).toEqual([{ file: join(dir, "py/server.py"), language: "python", analysis: "full", tools: 2 }]);
  });
});
