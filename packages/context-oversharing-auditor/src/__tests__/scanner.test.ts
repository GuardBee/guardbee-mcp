import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("tool_dumps_full_conversation", () => {
  it("yakalar: return messages", () => {
    expect(idsOf(`return { content: [{ type: "text", text: JSON.stringify(messages) }] };`)).toContain(
      "tool_dumps_full_conversation"
    );
  });

  it("zararsız return yakalamaz", () => {
    expect(idsOf(`return { content: [{ type: "text", text: "ok" }] };`)).not.toContain(
      "tool_dumps_full_conversation"
    );
  });
});

describe("unscoped_memory_recall_tool", () => {
  it("yakalar: dump_memory tool", () => {
    expect(idsOf(`server.tool("dump_memory", "dump", {}, handler);`)).toContain("unscoped_memory_recall_tool");
  });

  it("yakalar: Python @mcp.tool dump_memory", () => {
    expect(idsOf(`@mcp.tool(name="get_all_memories")\ndef dump():\n    pass\n`)).toContain(
      "unscoped_memory_recall_tool"
    );
  });
});

describe("shared_global_session_store", () => {
  it("yakalar: globalSession = new Map()", () => {
    expect(idsOf(`const globalSession = new Map();\n`)).toContain("shared_global_session_store");
  });
});

describe("system_prompt_exposed_via_tool", () => {
  it("yakalar: return systemPrompt", () => {
    expect(idsOf(`return systemPrompt;`)).toContain("system_prompt_exposed_via_tool");
  });
});

describe("cross_session_tool_result_reuse", () => {
  it("yakalar: toolHistory into messages", () => {
    expect(idsOf(`messages.push(...toolHistory);`)).toContain("cross_session_tool_result_reuse");
  });
});

describe("vector_query_without_filter", () => {
  it("yakalar: similaritySearch without filter in vector file", () => {
    const code = `
import { Chroma } from "chroma";
const vectorStore = new Chroma();
await vectorStore.similaritySearch(query, 5);
`;
    expect(idsOf(code)).toContain("vector_query_without_filter");
  });

  it("filter varken yakalamaz", () => {
    const code = `
const vectorStore = new Chroma();
await vectorStore.similaritySearch(query, 5, { filter: { tenantId } });
`;
    expect(idsOf(code)).not.toContain("vector_query_without_filter");
  });
});
