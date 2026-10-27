import { describe, expect, it } from "vitest";
import { join } from "path";
import { scanFile, scanText } from "../scanner.js";

const fixtures = join(__dirname, "fixtures");
const found = (file: string) => scanFile(join(fixtures, file)).findings.map((f) => `${f.patternId}@${f.line}`);

describe("Python tool input flows", () => {
  it("follows FastMCP parameters into shell, file, HTTP and SQL sinks", () => {
    expect(found("python/vulnerable_server.py")).toEqual([
      "python_shell_from_tool_input@18",
      "python_fs_write_from_tool_input@24",
      "python_ssrf_from_tool_input@33",
      "python_sql_injection_via_tool_input@41",
      "python_unrestricted_shell_tool_name@45",
      "python_shell_from_tool_input@48",
    ]);
  });

  it("follows a parameter through an assignment (command = f\"du {directory}\")", () => {
    const shell = scanFile(join(fixtures, "python/vulnerable_server.py")).findings.find((f) => f.line === 18)!;
    expect(shell.severity).toBe("critical");
    expect(shell.match).toContain("(input: command)");
    expect(shell.language).toBe("python");
  });

  it("does not report fixed commands, parameterized SQL or a path checked against its base", () => {
    expect(found("python/clean_server.py")).toEqual([]);
  });

  it("reports a regex-pattern hit and a flow on the same line once", () => {
    const source = '@mcp.tool()\ndef sh(args: str) -> str:\n    """Run."""\n    return subprocess.run(args.split())\n';
    expect(scanText(source, "s.py").filter((f) => f.patternId === "python_shell_from_tool_input")).toHaveLength(1);
  });
});

describe("Go tool input flows", () => {
  it("follows go-sdk typed args and mcp-go request reads into sinks", () => {
    expect(found("go/vulnerable.go").sort()).toEqual(
      ["go_shell_from_tool_input@52", "go_fs_write_from_tool_input@61", "go_ssrf_from_tool_input@37", "go_sql_injection_via_tool_input@69"].sort(),
    );
  });

  it("rates exec.Command with a shell critical and without one high", () => {
    const tool = (body: string) => `package main
func main() { s.AddTool(mcp.NewTool("x"), h) }
func h(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	host, _ := request.RequireString("host")
	${body}
	return nil, nil
}
`;
    const viaShell = scanText(tool('exec.Command("bash", "-c", "ping "+host).Run()'), "a.go");
    const direct = scanText(tool('exec.Command("ping", "-c", "1", host).Run()'), "a.go");
    expect(viaShell.map((f) => f.severity)).toEqual(["critical"]);
    expect(direct.map((f) => f.severity)).toEqual(["high"]);
  });

  it("does not report fixed commands, placeholders or a filepath.IsLocal check", () => {
    expect(found("go/clean.go")).toEqual([]);
  });
});
