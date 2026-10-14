import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import type { GatewayConfig } from "../gateway/config.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

const TCKN = "10000000146";

/** A one-page PDF with a text layer. */
function textPdf(line: string): string {
  const content = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1").toString("base64");
}

function setup(content: CallToolResult["content"], documents?: NonNullable<GatewayConfig["interceptors"]>["documents"], blobs: { uri: string; blob: string }[] = []) {
  const events: AuditEvent[] = [];
  const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
  const upstream = fakeUpstream("files", [{ name: "get_attachment" }]);
  upstream.callTool = async () => ({ content });
  upstream.listResources = async () => blobs.map(({ uri }) => ({ uri, name: uri }));
  upstream.readResource = async (uri: string) => ({ contents: blobs.filter((b) => b.uri === uri).map((b) => ({ uri: b.uri, mimeType: "application/pdf", blob: b.blob })) });
  const gw = new Gateway([upstream], gatewayConfig({ interceptors: documents ? { documents } : {}, taint: { mode: "off", basis: "capability" } }), audit);
  return { gw, events };
}

describe("interceptors.documents", () => {
  const pdf = textPdf(`Musteri TC ${TCKN} IBAN TR330006100519786457841326`);
  const attachment: CallToolResult["content"] = [
    { type: "text", text: "Here is the contract" },
    { type: "resource", resource: { uri: "file:///contract.pdf", mimeType: "application/pdf", blob: pdf } },
  ];

  it("is off by default: a PDF passes through unread", async () => {
    const { gw } = setup(attachment);
    await gw.listTools();
    const result = await gw.callTool("files__get_attachment", {});
    expect(result.content[1]).toMatchObject({ type: "resource" });
  });

  it("block withholds a PDF holding PII and counts it", async () => {
    const { gw, events } = setup(attachment, { enabled: true, action: "block", ocr: false });
    await gw.listTools();
    const result = await gw.callTool("files__get_attachment", {});
    expect(result.content).toHaveLength(2);
    expect(textOf(result)).toContain("file:///contract.pdf withheld: it holds tc_kimlik ×1, iban ×1");
    expect(JSON.stringify(result)).not.toContain(pdf.slice(0, 40));
    expect(events.find((e) => e.ruleId === "documents:pii")).toMatchObject({ type: "blocked" });
    expect(events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ tc_kimlik: 1, iban: 1 });
  });

  it("warn keeps the document and logs it; a clean document passes", async () => {
    const warn = setup(attachment, { enabled: true, action: "warn", ocr: false });
    await warn.gw.listTools();
    expect((await warn.gw.callTool("files__get_attachment", {})).content[1]).toMatchObject({ type: "resource" });
    expect(warn.events.find((e) => e.ruleId === "documents:pii")).toMatchObject({ type: "warn" });

    const clean = setup([{ type: "resource", resource: { uri: "file:///memo.pdf", mimeType: "application/pdf", blob: textPdf("Team lunch moved to Friday afternoon") } }], {
      enabled: true,
      action: "block",
      ocr: false,
    });
    await clean.gw.listTools();
    expect((await clean.gw.callTool("files__get_attachment", {})).content[0]).toMatchObject({ type: "resource" });
  });

  it("logs a document it could not read", async () => {
    const { gw, events } = setup([{ type: "image", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64"), mimeType: "image/png" }], {
      enabled: true,
      action: "block",
      ocr: false,
    });
    await gw.listTools();
    await gw.callTool("files__get_attachment", {});
    expect(events.find((e) => e.ruleId === "documents:unread")?.reason).toContain("image (image/png)");
  });

  it("withholds a resource blob holding PII", async () => {
    const { gw } = setup([], { enabled: true, action: "block", ocr: false }, [{ uri: "file:///payroll.pdf", blob: pdf }]);
    await gw.listResources();
    const read = await gw.readResource("file:///payroll.pdf");
    expect(read.contents[0]).toMatchObject({ uri: "file:///payroll.pdf", mimeType: "text/plain" });
    expect((read.contents[0] as { text: string }).text).toContain("withheld");
  });
});
