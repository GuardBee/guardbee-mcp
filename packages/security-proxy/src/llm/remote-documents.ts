import { guardedFetch, type EgressPolicy } from "@guardbee/guard-core";
import type { LlmDocuments } from "./config.js";
import type { DocumentModality } from "./documents.js";
import type { LlmShape } from "./shapes.js";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Public http(s) only: loopback, private and metadata addresses are refused. */
const DOCUMENT_EGRESS: EgressPolicy = { mode: "open", blockPrivate: true };

export type RemoteFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface RemoteDocumentOptions {
  maxBytes: number;
  timeoutSeconds: number;
  /** Override for tests; default is a private-blocking guardedFetch. */
  fetch?: RemoteFetch;
}

/** Fetch a PDF or image URL under size and time caps. Throws on SSRF / size / HTTP errors. */
export async function fetchDocumentBytes(url: string, options: RemoteDocumentOptions): Promise<{ bytes: Buffer; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`document url is not a URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`document url must be http(s) (got ${parsed.protocol})`);
  }

  const fetchImpl = options.fetch ?? guardedFetch(DOCUMENT_EGRESS);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.timeoutSeconds * 1000);
  timer.unref?.();
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", redirect: "follow", signal: abort.signal });
  } catch (err) {
    if (abort.signal.aborted) throw new Error(`fetching the document took over ${options.timeoutSeconds} s (llm.documents.timeoutSeconds)`);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`document url answered HTTP ${res.status}`);

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > options.maxBytes) {
    throw new Error(`${length} bytes, over llm.documents.maxBytes (${options.maxBytes})`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > options.maxBytes) throw new Error(`${total} bytes, over llm.documents.maxBytes (${options.maxBytes})`);
      chunks.push(chunk);
    }
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > options.maxBytes) throw new Error(`${buf.length} bytes, over llm.documents.maxBytes (${options.maxBytes})`);
    chunks.push(buf);
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

function dataUrl(modality: "pdf" | "image", bytes: Buffer, contentType: string): string {
  if (modality === "pdf") return `data:application/pdf;base64,${bytes.toString("base64")}`;
  const mime = contentType.startsWith("image/") ? contentType : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function asDataUrl(url: string, modality: "pdf" | "image", options: RemoteDocumentOptions): Promise<string> {
  const { bytes, contentType } = await fetchDocumentBytes(url, options);
  return dataUrl(modality, bytes, contentType);
}

/**
 * Replace http(s) PDF and image URLs in a request with `data:` URLs so the
 * existing inline document pipeline can read them. Provider `file_id` values
 * are left alone (still unmaskable). Fetch failures leave the URL in place so
 * readDocuments / unmaskableParts refuse the request when masking applies.
 */
export async function hydrateRemoteDocuments(
  shape: LlmShape,
  body: Json,
  modalities: ReadonlySet<DocumentModality>,
  config: Pick<LlmDocuments, "maxBytes" | "timeoutSeconds">,
  fetchImpl?: RemoteFetch,
): Promise<Json> {
  const options: RemoteDocumentOptions = {
    maxBytes: config.maxBytes,
    timeoutSeconds: config.timeoutSeconds,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  };

  const tryHydrate = async (url: unknown, modality: "pdf" | "image"): Promise<string | null> => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
    if (!modalities.has(modality)) return null;
    try {
      return await asDataUrl(url, modality, options);
    } catch {
      // Fail closed: a placeholder the reader cannot parse becomes documents:unread → 415 while masking applies
      return modality === "pdf" ? "data:application/pdf;base64,AA==" : "data:image/png;base64,AA==";
    }
  };

  if (shape === "openai") {
    if (!Array.isArray(body["messages"])) return body;
    const messages = await Promise.all(
      body["messages"].map(async (m) => {
        if (!isObject(m) || !Array.isArray(m["content"])) return m;
        const content = await Promise.all(
          m["content"].map(async (part) => {
            if (!isObject(part)) return part;
            if (part["type"] === "image_url" && isObject(part["image_url"])) {
              const data = await tryHydrate(part["image_url"]["url"], "image");
              return data ? { ...part, image_url: { ...part["image_url"], url: data } } : part;
            }
            if (part["type"] === "file" && isObject(part["file"])) {
              const file = part["file"];
              const data = await tryHydrate(file["file_data"] ?? file["file_url"], "pdf");
              return data ? { ...part, file: { ...file, file_data: data } } : part;
            }
            return part;
          }),
        );
        return { ...m, content };
      }),
    );
    return { ...body, messages };
  }

  if (shape === "anthropic") {
    const blocks = async (content: unknown): Promise<unknown> => {
      if (!Array.isArray(content)) return content;
      return Promise.all(
        content.map(async (block) => {
          if (!isObject(block)) return block;
          if (block["type"] === "tool_result") return { ...block, content: await blocks(block["content"]) };
          if ((block["type"] === "image" || block["type"] === "document") && isObject(block["source"])) {
            const source = block["source"];
            if (source["type"] !== "url" || typeof source["url"] !== "string") return block;
            const modality = block["type"] === "image" ? "image" : "pdf";
            const data = await tryHydrate(source["url"], modality);
            if (!data) return block;
            const mediaType = modality === "pdf" ? "application/pdf" : data.slice(5, data.indexOf(";"));
            return { ...block, source: { type: "base64", media_type: mediaType, data: data.slice(data.indexOf(",") + 1) } };
          }
          return block;
        }),
      );
    };
    const out: Json = { ...body };
    if (Array.isArray(body["system"])) out["system"] = await blocks(body["system"]);
    if (Array.isArray(body["messages"])) {
      out["messages"] = await Promise.all(body["messages"].map(async (m) => (isObject(m) ? { ...m, content: await blocks(m["content"]) } : m)));
    }
    return out;
  }

  if (shape === "responses") {
    if (!Array.isArray(body["input"])) return body;
    const parts = async (content: unknown): Promise<unknown> => {
      if (!Array.isArray(content)) return content;
      return Promise.all(
        content.map(async (part) => {
          if (!isObject(part)) return part;
          if (part["type"] === "input_image") {
            const data = await tryHydrate(part["image_url"], "image");
            return data ? { ...part, image_url: data } : part;
          }
          if (part["type"] === "input_file") {
            const data = await tryHydrate(part["file_url"] ?? part["file_data"], "pdf");
            return data ? { ...part, file_data: data } : part;
          }
          return part;
        }),
      );
    };
    return {
      ...body,
      input: await Promise.all(
        body["input"].map(async (item) => {
          if (!isObject(item)) return item;
          const type = item["type"];
          if (type === undefined || type === "message") return { ...item, content: await parts(item["content"]) };
          if (typeof type === "string" && type.endsWith("_call_output")) return { ...item, output: await parts(item["output"]) };
          return item;
        }),
      ),
    };
  }

  return body;
}
