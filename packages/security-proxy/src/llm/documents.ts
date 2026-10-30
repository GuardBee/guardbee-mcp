import type { LlmShape } from "./shapes.js";

/**
 * PDFs sent inline in a request: OpenAI `file` parts and Responses
 * `input_file` parts with a `data:application/pdf;base64,` URL, Anthropic
 * `document` blocks with a base64 PDF source. A file id or URL is not
 * inline: the proxy cannot read it and it stays unmaskable.
 */

type Json = Record<string, unknown>;

export interface InlineDocument {
  /** File name or title when the client gave one, else its position. */
  label: string;
  /** Base64 bytes. */
  data: string;
}

/** Returns the part to put in place of a document (`part` is the original), or undefined to keep it. */
export type DocumentMapper = (doc: InlineDocument, index: number, part: Json) => Json | undefined;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const PDF_DATA_URL = /^data:application\/pdf(?:;[^,;]*)*;base64,/i;

function fromDataUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = PDF_DATA_URL.exec(url);
  return m ? url.slice(m[0].length) : null;
}

/**
 * Visit every inline PDF in a request body, in a fixed order, and replace
 * the ones `fn` returns a part for. The body is not changed in place.
 */
export function mapDocuments(shape: LlmShape, body: Json, fn: DocumentMapper): Json {
  let index = 0;
  const visit = (doc: InlineDocument, part: Json): Json | undefined => fn(doc, index++, part);

  if (shape === "openai") {
    const parts = (content: unknown): unknown =>
      Array.isArray(content)
        ? content.map((part) => {
            if (!isObject(part) || part["type"] !== "file" || !isObject(part["file"])) return part;
            const data = fromDataUrl(part["file"]["file_data"]);
            if (data === null) return part;
            const name = part["file"]["filename"];
            return visit({ label: typeof name === "string" && name ? name : `file ${index + 1}`, data }, part) ?? part;
          })
        : content;
    if (!Array.isArray(body["messages"])) return body;
    return { ...body, messages: body["messages"].map((m) => (isObject(m) ? { ...m, content: parts(m["content"]) } : m)) };
  }

  if (shape === "anthropic") {
    const blocks = (content: unknown): unknown =>
      Array.isArray(content)
        ? content.map((block) => {
            if (!isObject(block)) return block;
            if (block["type"] === "tool_result") return { ...block, content: blocks(block["content"]) };
            if (block["type"] !== "document" || !isObject(block["source"])) return block;
            const source = block["source"];
            if (source["type"] === "content") return { ...block, source: { ...source, content: blocks(source["content"]) } };
            if (source["type"] !== "base64" || source["media_type"] !== "application/pdf" || typeof source["data"] !== "string") return block;
            const title = block["title"];
            return visit({ label: typeof title === "string" && title ? title : `document ${index + 1}`, data: source["data"] }, block) ?? block;
          })
        : content;
    const out: Json = { ...body };
    if (Array.isArray(body["system"])) out["system"] = blocks(body["system"]);
    if (Array.isArray(body["messages"])) out["messages"] = body["messages"].map((m) => (isObject(m) ? { ...m, content: blocks(m["content"]) } : m));
    return out;
  }

  if (shape === "responses") {
    const parts = (content: unknown): unknown =>
      Array.isArray(content)
        ? content.map((part) => {
            if (!isObject(part) || part["type"] !== "input_file") return part;
            const data = fromDataUrl(part["file_data"]);
            if (data === null) return part;
            const name = part["filename"];
            return visit({ label: typeof name === "string" && name ? name : `file ${index + 1}`, data }, part) ?? part;
          })
        : content;
    if (!Array.isArray(body["input"])) return body;
    return {
      ...body,
      input: body["input"].map((item) => {
        if (!isObject(item)) return item;
        const type = item["type"];
        if (type === undefined || type === "message") return { ...item, content: parts(item["content"]) };
        if (typeof type === "string" && type.endsWith("_call_output")) return { ...item, output: parts(item["output"]) };
        return item;
      }),
    };
  }

  return body;
}

/**
 * The text part each API takes in place of a document, so every check reads
 * the document's text. An Anthropic document keeps its title and context
 * (both are checked as well) with a text source.
 */
export function textPart(shape: LlmShape, text: string, original: Json): Json {
  if (shape === "anthropic") return { ...original, source: { type: "text", media_type: "text/plain", data: text } };
  if (shape === "responses") return { type: "input_text", text };
  return { type: "text", text };
}

/** Decoded size of base64 data, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}
