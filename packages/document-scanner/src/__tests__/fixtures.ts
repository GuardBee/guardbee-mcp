/** Test documents built at run time, so no binary fixtures live in the repo. */

/** A minimal one-page PDF; `content` is the page's content stream, `xobjects` extra image objects. */
function pdf(content: string, image?: { jpeg: Uint8Array; width: number; height: number }): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: (Uint8Array | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const piece of body) push(piece);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n");
  object(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  object(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  const resources = image ? "<< /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >>" : "<< /Font << /F1 5 0 R >> >>";
  object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources ${resources} >>`]);
  object(4, [`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`]);
  object(5, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
  if (image) {
    object(6, [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`,
      image.jpeg,
      "\nendstream",
    ]);
  }
  const xref = length;
  const count = image ? 7 : 6;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A PDF with a text layer: one line per string. */
export function textPdf(lines: string[]): Uint8Array {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const body = lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${escape(line)}) Tj ET`).join("\n");
  return pdf(body);
}

async function canvasModule() {
  return (await import("@napi-rs/canvas")) as typeof import("@napi-rs/canvas");
}

/** Black text on white, large enough for OCR. */
export async function textImage(lines: string[], format: "png" | "jpeg" = "png"): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { createCanvas } = await canvasModule();
  const width = 1400;
  const height = 80 + lines.length * 70;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = "44px sans-serif";
  lines.forEach((line, i) => ctx.fillText(line, 40, 70 + i * 70));
  const bytes = format === "png" ? await canvas.encode("png") : await canvas.encode("jpeg", 95);
  return { bytes: new Uint8Array(bytes), width, height };
}

/** A scanned page: the text only as a picture, no text layer. */
export async function scannedPdf(lines: string[]): Promise<Uint8Array> {
  const image = await textImage(lines, "jpeg");
  const w = 540;
  const h = Math.round((image.height / image.width) * w);
  return pdf(`q ${w} 0 0 ${h} 36 ${756 - h} cm /Im1 Do Q`, { jpeg: image.bytes, width: image.width, height: image.height });
}
