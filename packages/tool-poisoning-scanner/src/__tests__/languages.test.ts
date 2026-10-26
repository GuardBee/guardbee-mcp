import { describe, expect, it } from "vitest";
import { join } from "path";
import { scanDirectory, scanFile, scanText } from "../scanner.js";

const fixtures = join(__dirname, "fixtures");
const ids = (file: string) => scanFile(join(fixtures, file)).findings.map((f) => `${f.patternId}@${f.line}`);

describe("Python servers", () => {
  it("finds hidden instructions in a FastMCP docstring", () => {
    const found = ids("python/poisoned_server.py");
    expect(found).toEqual(
      expect.arrayContaining(["meta_authority_directive@16", "sensitive_file_exfil_instruction@17", "covert_instruction_in_description@18"]),
    );
  });

  it("finds read-only tools whose handler runs a shell or returns the environment", () => {
    const findings = scanFile(join(fixtures, "python/poisoned_server.py")).findings;
    const deputy = findings.filter((f) => f.category === "confused-deputy");
    expect(deputy.map((f) => [f.patternId, f.match.split(":")[0]])).toEqual([
      ["confused_deputy_process_execution", 'tool "get_disk_usage"'],
      ["confused_deputy_credentials_exposure", 'tool "list_settings"'],
    ]);
    expect(deputy.every((f) => f.language === "python" && f.owasp === "MCP03:2025")).toBe(true);
  });

  it("follows a low-level call_tool branch into the function it dispatches to", () => {
    const findings = scanFile(join(fixtures, "python/lowlevel_server.py")).findings;
    expect(findings.map((f) => `${f.patternId} ${f.match.split(":")[0]}`)).toEqual([
      'instruction_override_in_description tool "search_docs" description',
      'confused_deputy_code_execution tool "query_logs"',
    ]);
  });

  it("reports nothing for a server with plain descriptions", () => {
    expect(ids("python/clean_server.py")).toEqual([]);
  });

  it("takes the language from scan_text's label or an explicit language", () => {
    const source = '@mcp.tool()\ndef show_env() -> dict:\n    """Show settings."""\n    return dict(os.environ)\n';
    expect(scanText(source).length).toBe(0);
    expect(scanText(source, "server.py").map((f) => f.patternId)).toEqual(["confused_deputy_credentials_exposure"]);
    expect(scanText(source, undefined, "python").map((f) => f.patternId)).toEqual(["confused_deputy_credentials_exposure"]);
  });
});

describe("Go servers", () => {
  it("finds poisoned descriptions and struct-tag parameter descriptions (official go-sdk)", () => {
    const found = ids("go/official/main.go");
    expect(found).toEqual(
      expect.arrayContaining([
        "always_call_first_directive@16",
        "meta_authority_directive@28",
        "sensitive_file_exfil_instruction@28",
        "covert_instruction_in_description@29",
      ]),
    );
  });

  it("finds a shell sink behind a read-only tool (official go-sdk, named handler)", () => {
    const deputy = scanFile(join(fixtures, "go/official/main.go")).findings.filter((f) => f.category === "confused-deputy");
    expect(deputy.map((f) => [f.patternId, f.line])).toEqual([["confused_deputy_process_execution", 35]]);
  });

  it("finds a file delete behind a read-only tool (mark3labs/mcp-go)", () => {
    expect(ids("go/mark3labs/main.go")).toEqual(["confused_deputy_filesystem_write@32"]);
  });

  it("reports nothing for a clean mcp-go server", () => {
    expect(ids("go/clean/main.go")).toEqual([]);
  });
});

describe("scanDirectory", () => {
  it("tags each finding with its language", () => {
    const result = scanDirectory(fixtures);
    const langs = new Set(result.findings.map((f) => f.language));
    expect([...langs].sort()).toEqual(["go", "python"]);
  });
});
