import type { LlmShape } from "./shapes.js";

/**
 * PDFs and images sent inline in a request.
 *
 * - PDFs: OpenAI `file` parts and Responses `input_file` parts with a
 *   `data:application/pdf;base64,` URL, Anthropic `document` blocks with a
 *   base64 PDF source. A file id or URL is not inline: the proxy cannot read
 *   it and it stays unmaskable.
 * - Images: OpenAI `image_url` parts and Responses `input_image` parts with a
 *   `data:image/...;base64,` URL, Anthropic `image` blocks with a base64
 *   source. An image given by URL or file id is not fetched.
 * - Audio: OpenAI Chat Completions `input_audio` parts (base64 data and a
 *   format). Responses and Anthropic take no audio input.
 */

type Json = Record<string, unknown>;

export type DocumentModality = "pdf" | "image" | "audio";

const PDF_ONLY: ReadonlySet<DocumentModality> = new Set(["pdf"]);

export interface InlineDocument {
  modality: DocumentModality;
  /** File name or title when the client gave one, else its position. */
  label: string;
  /** Base64 bytes. */
  data: string;
  /** The audio format the client named (`wav`, `mp3`). */
  format?: string;
}

/** Returns the part to put in place of a document (`part` is the original), or undefined to keep it. */
export type DocumentMapper = (doc: InlineDocument, index: number, part: Json) => Json | undefined;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const PDF_DATA_URL = /^data:application\/pdf(?:;[^,;]*)*;base64,/i;
const IMAGE_DATA_URL = /^data:image\/[\w.+-]+(?:;[^,;]*)*;base64,/i;

function fromDataUrl(url: unknown, pattern = PDF_DATA_URL): string | null {
  if (typeof url !== "string") return null;
  const m = pattern.exec(url);
  return m ? url.slice(m[0].length) : null;
}

/**
 * Visit every inline PDF (and image, when `modalities` has "image") in a
 * request body, in a fixed order, and replace the ones `fn` returns a part
 * for. The body is not changed in place.
 */
export function mapDocuments(shape: LlmShape, body: Json, fn: DocumentMapper, modalities: ReadonlySet<DocumentModality> = PDF_ONLY): Json {
  let index = 0;
  const visit = (doc: Omit<InlineDocument, "label"> & { label?: unknown }, part: Json): Json | undefined => {
    if (!modalities.has(doc.modality)) return undefined;
    const label = typeof doc.label === "string" && doc.label ? doc.label : `${doc.modality === "pdf" ? "file" : doc.modality} ${index + 1}`;
    return fn({ modality: doc.modality, label, data: doc.data, ...(doc.format !== undefined ? { format: doc.format } : {}) }, index++, part);
  };

  if (shape === "openai") {
    const parts = (content: unknown): unknown =>
      Array.isArray(content)
        ? content.map((part) => {
            if (!isObject(part)) return part;
            if (part["type"] === "input_audio" && isObject(part["input_audio"])) {
              const audio = part["input_audio"];
              if (typeof audio["data"] !== "string") return part;
              return visit({ modality: "audio", data: audio["data"], format: typeof audio["format"] === "string" ? audio["format"] : "" }, part) ?? part;
            }
            if (part["type"] === "image_url" && isObject(part["image_url"])) {
              const data = fromDataUrl(part["image_url"]["url"], IMAGE_DATA_URL);
              return data === null ? part : (visit({ modality: "image", data }, part) ?? part);
            }
            if (part["type"] !== "file" || !isObject(part["file"])) return part;
            const data = fromDataUrl(part["file"]["file_data"]);
            if (data === null) return part;
            return visit({ modality: "pdf", label: part["file"]["filename"], data }, part) ?? part;
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
            if (block["type"] === "image" && isObject(block["source"])) {
              const source = block["source"];
              if (source["type"] !== "base64" || typeof source["data"] !== "string") return block;
              return visit({ modality: "image", data: source["data"] }, block) ?? block;
            }
            if (block["type"] !== "document" || !isObject(block["source"])) return block;
            const source = block["source"];
            if (source["type"] === "content") return { ...block, source: { ...source, content: blocks(source["content"]) } };
            if (source["type"] !== "base64" || source["media_type"] !== "application/pdf" || typeof source["data"] !== "string") return block;
            const title = block["title"];
            return visit({ modality: "pdf", label: typeof title === "string" && title ? title : `document ${index + 1}`, data: source["data"] }, block) ?? block;
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
            if (!isObject(part)) return part;
            if (part["type"] === "input_image") {
              const data = fromDataUrl(part["image_url"], IMAGE_DATA_URL);
              return data === null ? part : (visit({ modality: "image", data }, part) ?? part);
            }
            if (part["type"] !== "input_file") return part;
            const data = fromDataUrl(part["file_data"]);
            if (data === null) return part;
            return visit({ modality: "pdf", label: part["filename"], data }, part) ?? part;
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
 * The text part each API takes in place of a document or image, so every
 * check reads its text. An Anthropic document keeps its title and context
 * (both are checked as well) with a text source.
 */
export function textPart(shape: LlmShape, text: string, original: Json): Json {
  if (shape === "anthropic") {
    return original["type"] === "document" ? { ...original, source: { type: "text", media_type: "text/plain", data: text } } : { type: "text", text };
  }
  if (shape === "responses") return { type: "input_text", text };
  return { type: "text", text };
}

/** Decoded size of base64 data, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}
