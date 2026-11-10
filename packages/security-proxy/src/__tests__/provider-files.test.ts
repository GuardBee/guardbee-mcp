import { describe, expect, it } from "vitest";
import { fetchProviderFile, hydrateProviderFiles } from "../llm/provider-files.js";

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

describe("fetchProviderFile", () => {
  it("downloads from the provider Files API with the routed key", async () => {
    const pdf = textPdf("hello");
    const seen: { url: string; auth: string | null }[] = [];
    const { bytes } = await fetchProviderFile("file-abc", {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      maxBytes: 10_000,
      timeoutSeconds: 2,
      fetch: async (url, init) => {
        seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
        return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
      },
    });
    expect(seen).toEqual([{ url: "https://api.openai.com/v1/files/file-abc/content", auth: "Bearer sk-test" }]);
    expect(bytes.equals(pdf)).toBe(true);
  });

  it("refuses a path-like file_id", async () => {
    await expect(
      fetchProviderFile("../etc/passwd", {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        maxBytes: 10_000,
        timeoutSeconds: 2,
        fetch: async () => new Response("no"),
      }),
    ).rejects.toThrow(/invalid file_id/);
  });
});

describe("hydrateProviderFiles", () => {
  it("rewrites Chat Completions file_id to a data URL", async () => {
    const pdf = textPdf("TC");
    const body = await hydrateProviderFiles(
      "openai",
      { messages: [{ role: "user", content: [{ type: "file", file: { file_id: "file-1" } }] }] },
      new Set(["pdf"]),
      {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        maxBytes: 10_000,
        timeoutSeconds: 2,
        fetch: async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
      },
    );
    const data = (body["messages"] as { content: { file: { file_data: string } }[] }[])[0]!.content[0]!.file.file_data;
    expect(data.startsWith("data:application/pdf;base64,")).toBe(true);
  });

  it("rewrites Responses input_file file_id", async () => {
    const pdf = textPdf("ok");
    const body = await hydrateProviderFiles(
      "responses",
      { input: [{ type: "message", role: "user", content: [{ type: "input_file", file_id: "file-2" }] }] },
      new Set(["pdf"]),
      {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        maxBytes: 10_000,
        timeoutSeconds: 2,
        fetch: async () => new Response(pdf, { status: 200 }),
      },
    );
    const part = (body["input"] as { content: { file_data: string }[] }[])[0]!.content[0]!;
    expect(part.file_data.startsWith("data:application/pdf;base64,")).toBe(true);
  });
});
