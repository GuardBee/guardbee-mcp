import type { DocumentModality } from "./documents.js";
import type { LlmShape } from "./shapes.js";
import type { RemoteFetch } from "./remote-documents.js";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export interface ProviderFileOptions {
  /** Provider base URL without a trailing slash (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  apiKey: string;
  maxBytes: number;
  timeoutSeconds: number;
  /** Override for tests. */
  fetch?: RemoteFetch;
}

/** OpenAI-compatible `GET {baseUrl}/files/{id}/content` under size and time caps. */
export async function fetchProviderFile(fileId: string, options: ProviderFileOptions): Promise<{ bytes: Buffer; contentType: string }> {
  if (typeof fileId !== "string" || !fileId || /[/\\?]/.test(fileId)) {
    throw new Error(`invalid file_id: ${fileId}`);
  }
  const url = `${options.baseUrl.replace(/\/$/, "")}/files/${encodeURIComponent(fileId)}/content`;
  const fetchImpl = options.fetch ?? fetch;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.timeoutSeconds * 1000);
  timer.unref?.();
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: abort.signal,
    });
  } catch (err) {
    if (abort.signal.aborted) throw new Error(`fetching file_id took over ${options.timeoutSeconds} s (llm.documents.timeoutSeconds)`);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`file_id ${fileId} answered HTTP ${res.status}`);

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

function asPdfDataUrl(bytes: Buffer): string {
  return `data:application/pdf;base64,${bytes.toString("base64")}`;
}

/**
 * Replace OpenAI-style `file_id` references with inline PDF data URLs by
 * downloading from the routed provider's Files API. Failures become an
 * unreadable placeholder so masking stays fail-closed (415).
 */
export async function hydrateProviderFiles(
  shape: LlmShape,
  body: Json,
  modalities: ReadonlySet<DocumentModality>,
  options: ProviderFileOptions,
): Promise<Json> {
  if (!modalities.has("pdf")) return body;

  const tryFile = async (fileId: unknown): Promise<string | null> => {
    if (typeof fileId !== "string" || !fileId) return null;
    try {
      const { bytes } = await fetchProviderFile(fileId, options);
      return asPdfDataUrl(bytes);
    } catch {
      return "data:application/pdf;base64,AA==";
    }
  };

  if (shape === "openai") {
    if (!Array.isArray(body["messages"])) return body;
    const messages = await Promise.all(
      body["messages"].map(async (m) => {
        if (!isObject(m) || !Array.isArray(m["content"])) return m;
        const content = await Promise.all(
          m["content"].map(async (part) => {
            if (!isObject(part) || part["type"] !== "file" || !isObject(part["file"])) return part;
            const file = part["file"];
            if (typeof file["file_data"] === "string" && file["file_data"].startsWith("data:")) return part;
            const data = await tryFile(file["file_id"]);
            return data ? { ...part, file: { ...file, file_data: data, filename: file["filename"] ?? file["file_id"] } } : part;
          }),
        );
        return { ...m, content };
      }),
    );
    return { ...body, messages };
  }

  if (shape === "responses") {
    if (!Array.isArray(body["input"])) return body;
    const parts = async (content: unknown): Promise<unknown> => {
      if (!Array.isArray(content)) return content;
      return Promise.all(
        content.map(async (part) => {
          if (!isObject(part) || part["type"] !== "input_file") return part;
          if (typeof part["file_data"] === "string" && part["file_data"].startsWith("data:")) return part;
          const data = await tryFile(part["file_id"]);
          return data ? { ...part, file_data: data, filename: part["filename"] ?? part["file_id"] } : part;
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
