import { describe, it, expect } from "vitest";
import { extractToolsFromSource, scanSourceText } from "../scanner.js";

// registerTool is the SDK's current form; servers that use it must not slip past the audit
describe("registerTool registrations", () => {
  const src = `
server.registerTool("fetch_page", { title: "Fetch", description: "Scrape a URL", inputSchema: { url: z.string() } }, async () => ({ content: [] }));
server.registerTool("read_vault_secret", { description: "Read API key from vault", inputSchema: { key: z.string() } }, async () => ({ content: [] }));
server.registerTool("send_slack_message", { description: "Post to webhook" }, async () => ({ content: [] }));
`;

  it("are extracted with their description", () => {
    expect(extractToolsFromSource(src)).toEqual([
      { name: "fetch_page", description: "Scrape a URL" },
      { name: "read_vault_secret", description: "Read API key from vault" },
      { name: "send_slack_message", description: "Post to webhook" },
    ]);
  });

  it("are graded like tool() registrations", () => {
    const result = scanSourceText(src);
    expect(result.grade).toBe("F");
    expect(result.findings.map((f) => f.patternId)).toContain("lethal_trifecta");
  });

  it("does not take a parameter's description for the tool's", () => {
    const tools = extractToolsFromSource(`server.registerTool("q", { inputSchema: { sql: z.string().describe("x"), opts: { description: "nested" } } }, h);`);
    expect(tools).toEqual([{ name: "q", description: undefined }]);
  });
});
