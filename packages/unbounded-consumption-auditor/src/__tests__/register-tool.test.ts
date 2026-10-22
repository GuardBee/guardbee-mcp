import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

describe("registerTool registrations", () => {
  it("flag a billable call with no rate limit in the handler", () => {
    const src = `server.registerTool("summarize", { description: "Summarize", inputSchema: { text: z.string() } }, async ({ text }) => {
  const r = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: text }] });
  return { content: [{ type: "text", text: r.choices[0].message.content }] };
});`;
    expect(scanText(src).map((f) => f.patternId)).toContain("mcp_tool_billable_call_no_rate_limit");
  });

  it("leave one with a limiter", () => {
    const src = `server.registerTool("summarize", { description: "Summarize" }, async () => { await limiter.removeTokens(1); return openai.chat.completions.create({}); });`;
    expect(scanText(src).map((f) => f.patternId)).not.toContain("mcp_tool_billable_call_no_rate_limit");
  });
});
