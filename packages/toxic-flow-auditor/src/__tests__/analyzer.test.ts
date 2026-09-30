import { describe, it, expect } from "vitest";
import { auditCatalog, classifyTool, extractToolsFromSource } from "../index.js";

describe("classifyTool", () => {
  it("fetch toolunu untrusted sayar", () => {
    expect(classifyTool({ name: "fetch_url", description: "Download a page" })).toContain("untrusted-content");
  });

  it("vault toolunu sensitive sayar", () => {
    expect(classifyTool({ name: "get_secret", description: "Read from vault" })).toContain("sensitive-data");
  });

  it("KVKK / müşteri alanını sensitive sayar", () => {
    expect(
      classifyTool({
        name: "lookup_customer",
        description: "KVKK kapsamındaki müşteri kaydını getir",
        inputSchema: { properties: { tc_kimlik: { type: "string" } } },
      })
    ).toContain("sensitive-data");
  });

  it("send_email toolunu exfil sayar", () => {
    expect(classifyTool({ name: "send_email", description: "Notify user" })).toContain("exfiltration");
  });
});

describe("auditCatalog — lethal trifecta", () => {
  it("üç yetenek bir arada ise F ve lethal_trifecta üretir", () => {
    const result = auditCatalog([
      { name: "fetch_page", description: "Scrape a URL" },
      { name: "read_vault_secret", description: "Read API key from vault" },
      { name: "send_slack_message", description: "Post to webhook" },
    ]);
    expect(result.grade).toBe("F");
    expect(result.findings.map((f) => f.patternId)).toContain("lethal_trifecta");
    expect(result.findings[0]?.owasp).toBe("MCP10:2025");
  });

  it("sadece isim listesi temizse A üretir", () => {
    const result = auditCatalog([
      { name: "list_patterns", description: "List scanner rules" },
      { name: "scan_text", description: "Scan a string" },
    ]);
    expect(result.grade).toBe("A");
    expect(result.findings).toEqual([]);
  });

  it("sensitive + exfil çiftini high olarak işaretler", () => {
    const result = auditCatalog([
      { name: "get_db_row", description: "Read database users" },
      { name: "export_csv", description: "Export and upload report" },
    ]);
    expect(result.findings.map((f) => f.patternId)).toContain("sensitive_plus_exfil");
    expect(result.grade).toBe("C");
  });

  it("tek tool trifecta yakalar", () => {
    const result = auditCatalog([
      {
        name: "research_and_mail_secrets",
        description: "Fetch a URL, read vault secrets, and send email with findings",
      },
    ]);
    expect(result.findings.map((f) => f.patternId)).toContain("single_tool_trifecta");
    expect(result.grade).toBe("F");
  });

  it("destructive + sensitive çiftini yakalar", () => {
    const result = auditCatalog([
      { name: "read_customer_db", description: "SQL select from müşteri table" },
      { name: "drop_table", description: "Drop a database table" },
    ]);
    expect(result.findings.map((f) => f.patternId)).toContain("sensitive_plus_destruct");
  });
});

describe("extractToolsFromSource", () => {
  it("server.tool kayıtlarını çıkarır", () => {
    const src = `
server.tool("fetch_url", "Download page", {}, async () => {});
server.tool("send_email", "Mail user", {}, async () => {});
`;
    const tools = extractToolsFromSource(src);
    expect(tools.map((t) => t.name)).toEqual(["fetch_url", "send_email"]);
  });
});
