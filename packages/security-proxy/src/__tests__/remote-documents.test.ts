import { describe, expect, it } from "vitest";
import { EgressBlockedError } from "@guardbee/guard-core";
import { fetchDocumentBytes, hydrateRemoteDocuments } from "../llm/remote-documents.js";

function textPdf(line: string): Buffer {
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
  return Buffer.from(out, "latin1");
}

describe("fetchDocumentBytes", () => {
  it("refuses private and metadata addresses", async () => {
    await expect(fetchDocumentBytes("http://127.0.0.1/secret.pdf", { maxBytes: 1024, timeoutSeconds: 2 })).rejects.toBeInstanceOf(EgressBlockedError);
    await expect(fetchDocumentBytes("http://169.254.169.254/latest/meta-data", { maxBytes: 1024, timeoutSeconds: 2 })).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("returns bytes from an injected fetch under the size cap", async () => {
    const pdf = textPdf("hello");
    const { bytes, contentType } = await fetchDocumentBytes("https://files.example/report.pdf", {
      maxBytes: 10_000,
      timeoutSeconds: 2,
      fetch: async () =>
        new Response(pdf, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(pdf.length) } }),
    });
    expect(contentType).toBe("application/pdf");
    expect(bytes.equals(pdf)).toBe(true);
  });

  it("refuses a body over maxBytes", async () => {
    await expect(
      fetchDocumentBytes("https://files.example/big.pdf", {
        maxBytes: 8,
        timeoutSeconds: 2,
        fetch: async () => new Response(Buffer.alloc(32), { status: 200, headers: { "content-type": "application/pdf" } }),
      }),
    ).rejects.toThrow(/maxBytes/);
  });
});

describe("hydrateRemoteDocuments", () => {
  it("rewrites an OpenAI image_url http(s) to a data URL", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from("TC")]);
    const body = await hydrateRemoteDocuments(
      "openai",
      {
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://cdn.example/a.png" } }] }],
      },
      new Set(["image"]),
      { maxBytes: 10_000, timeoutSeconds: 2 },
      async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
    );
    const url = (body["messages"] as { content: { image_url: { url: string } }[] }[])[0]!.content[0]!.image_url.url;
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rewrites an Anthropic document url source to base64", async () => {
    const pdf = textPdf("TC kimlik");
    const body = await hydrateRemoteDocuments(
      "anthropic",
      {
        messages: [
          {
            role: "user",
            content: [{ type: "document", source: { type: "url", url: "https://cdn.example/a.pdf" } }],
          },
        ],
      },
      new Set(["pdf"]),
      { maxBytes: 10_000, timeoutSeconds: 2 },
      async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    const source = (body["messages"] as { content: { source: { type: string; data: string } }[] }[])[0]!.content[0]!.source;
    expect(source.type).toBe("base64");
    expect(source.data.length).toBeGreaterThan(20);
  });

  it("leaves file_id parts alone", async () => {
    const body = await hydrateRemoteDocuments(
      "openai",
      {
        messages: [{ role: "user", content: [{ type: "file", file: { file_id: "file-abc" } }] }],
      },
      new Set(["pdf"]),
      { maxBytes: 10_000, timeoutSeconds: 2 },
      async () => {
        throw new Error("should not fetch");
      },
    );
    expect((body["messages"] as { content: { file: { file_id: string } }[] }[])[0]!.content[0]!.file.file_id).toBe("file-abc");
  });
});
