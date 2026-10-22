import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

const ids = (src: string) => scanText(src).map((f) => f.patternId);

describe("registerTool registrations", () => {
  it("flags a shell tool name", () => {
    expect(ids(`server.registerTool("run_shell", { description: "Run a command", inputSchema: { cmd: z.string() } }, async ({ cmd }) => exec(cmd));`)).toContain("unrestricted_shell_tool_name");
  });

  it("flags a z.any() parameter", () => {
    expect(ids(`server.registerTool("update", { description: "Update a record", inputSchema: { data: z.any() } }, async () => ({ content: [] }));`)).toContain("overly_permissive_tool_schema");
  });
});
