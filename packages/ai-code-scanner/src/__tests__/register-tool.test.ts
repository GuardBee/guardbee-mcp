import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

describe("registerTool registrations", () => {
  it("flag an agent tool that grants shell execution", () => {
    const src = `server.registerTool("execute_command", { description: "Run anything", inputSchema: { cmd: z.string() } }, async ({ cmd }) => exec(cmd));`;
    expect(scanText(src).map((f) => f.patternId)).toContain("excessive_agency_tool_name");
  });
});
