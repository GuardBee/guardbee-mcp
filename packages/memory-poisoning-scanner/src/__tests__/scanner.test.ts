import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("scanText — memory-write", () => {
  it("yakalar: archival_memory_insert'e ham girdi", () => {
    const code = `archival_memory_insert(input.note)`;
    expect(idsOf(code)).toContain("archival_memory_insert_raw_input");
  });

  it("archival_memory_insert sabit/güvenilir bir string ile çağrılırsa yakalamaz", () => {
    const code = `archival_memory_insert("User prefers dark mode")`;
    expect(idsOf(code)).not.toContain("archival_memory_insert_raw_input");
  });

  it("yakalar: core_memory_append'e ham girdi", () => {
    const code = `core_memory_append("human", req.body.note)`;
    expect(idsOf(code)).toContain("core_memory_write_raw_input");
  });

  it("yakalar: core_memory_replace'e ham girdi", () => {
    const code = `core_memory_replace("persona", userInput)`;
    expect(idsOf(code)).toContain("core_memory_write_raw_input");
  });

  it("core_memory_append sabit bir string ile çağrılırsa yakalamaz", () => {
    const code = `core_memory_append("human", "Name is Alex")`;
    expect(idsOf(code)).not.toContain("core_memory_write_raw_input");
  });

  it("yakalar: vector store add_texts'e ham girdi", () => {
    const code = `await vectorstore.add_texts(req.body.documents)`;
    expect(idsOf(code)).toContain("vector_store_add_raw_input");
  });

  it("yakalar: vector store upsert'e ham girdi (camelCase varyantı)", () => {
    const code = `await index.upsert(params.vectors)`;
    expect(idsOf(code)).toContain("vector_store_add_raw_input");
  });

  it("vector store add_documents işlenmiş/sarmalanmış bir değişkenle çağrılırsa yakalamaz", () => {
    const code = `await vectorstore.add_documents(sanitizedDocs)`;
    expect(idsOf(code)).not.toContain("vector_store_add_raw_input");
  });

  it("yakalar: 'longTermMemory' adlı bir store'a ham girdi yazma", () => {
    const code = `longTermMemory.append(userInput)`;
    expect(idsOf(code)).toContain("generic_named_memory_write_raw_input");
  });

  it("sıradan bir conversation buffer'a yazma (kapsam dışı) hiçbir memory-write bulgusu üretmez", () => {
    const code = `chatHistory.push({ role: "user", content: userInput })`;
    const findings = scanText(code).filter((f) => f.category === "memory-write");
    expect(findings).toHaveLength(0);
  });
});

describe("scanText — memory-readback", () => {
  it("yakalar: archival_memory_search sonucu kısa sürede system role'e akıyor", () => {
    const code = `
const results = archival_memory_search(query);
messages.push({ role: "system", content: results.join("\\n") });
`;
    expect(idsOf(code)).toContain("archival_memory_feeds_trusted_role");
  });

  it("yakalar: vector similaritySearch sonucu system role'e akıyor", () => {
    const code = `
const docs = await vectorstore.similaritySearch(query);
messages.push({ role: "system", content: docs.map(d => d.pageContent).join("\\n") });
`;
    expect(idsOf(code)).toContain("vector_retrieval_feeds_trusted_role");
  });

  it("vector arama sonucu normal bir user/tool-result role'üne akarsa yakalamaz", () => {
    const code = `
const docs = await vectorstore.similaritySearch(query);
messages.push({ role: "user", content: docs.map(d => d.pageContent).join("\\n") });
`;
    expect(idsOf(code)).not.toContain("vector_retrieval_feeds_trusted_role");
  });

  it("yakalar: memory.search sonucu doğrudan prompt template'e interpolate ediliyor", () => {
    const code = `
const recalled = await memory.search(userId);
const prompt = \`Context: \${recalled}\`;
`;
    expect(idsOf(code)).toContain("memory_retrieval_feeds_prompt_template");
  });
});

describe("scanText — genel", () => {
  it("temiz bir agent kodunda hiçbir bulgu döndürmez", () => {
    const code = `
const history = new ConversationBufferMemory();
history.chat_memory.add_user_message(userInput);
const response = await llm.invoke([{ role: "user", content: userInput }]);
`;
    expect(scanText(code)).toHaveLength(0);
  });

  it("her bulgu recommendation içerir", () => {
    const findings = scanText(`archival_memory_insert(input.note)`);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.recommendation.length).toBeGreaterThan(10);
  });

  it("label verilirse file alanına yansır", () => {
    const findings = scanText(`archival_memory_insert(input.note)`, "agent.ts");
    expect(findings[0]?.file).toBe("agent.ts");
  });
});
