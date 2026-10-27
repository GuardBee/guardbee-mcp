import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Text out of a document: plain text as is, a PDF's text layer, and — when
 * the optional `tesseract.js` (and, for scanned PDFs, `@napi-rs/canvas`)
 * packages are installed — OCR for images and PDF pages without text.
 */

export type DocumentKind = "pdf" | "png" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "text" | "binary";

export type ExtractMethod = "text" | "pdf-text" | "ocr" | "pdf-ocr";

export interface ExtractedPage {
  /** 1-based; images and text files are one page. */
  page: number;
  text: string;
  method: ExtractMethod;
}

export interface Extraction {
  kind: DocumentKind;
  pages: ExtractedPage[];
  /** Why part of the document could not be read (no OCR installed, page limit, …). */
  notes: string[];
}

export interface ExtractOptions {
  /** Refuse anything larger (default 25 MB). */
  maxBytes?: number;
  /** PDF pages read at most (default 50). */
  maxPages?: number;
  /** Run OCR on images and on PDF pages with no text layer (default true; needs tesseract.js). */
  ocr?: boolean;
  /** Tesseract languages (default ["tur", "eng"]). */
  languages?: string[];
  /** Where Tesseract finds `<lang>.traineddata` — a local folder for offline use. */
  langPath?: string;
  /** Where downloaded language data is cached (default ~/.cache/guardbee/tessdata, never the working directory). */
  cachePath?: string;
  /** A PDF page with fewer characters than this counts as scanned (default 20). */
  minTextChars?: number;
}

const DEFAULTS = { maxBytes: 25 * 1024 * 1024, maxPages: 50, ocr: true, languages: ["tur", "eng"], minTextChars: 20 };

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);

/** What the bytes are, from their signature — never from a file name or a claimed MIME type. */
export function detectKind(bytes: Uint8Array): DocumentKind {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  return looksLikeText(bytes) ? "text" : "binary";
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.length === 0) return true;
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / sample.length < 0.02;
}

type Recognize = (image: Uint8Array) => Promise<string>;

/** A loaded optional module, or null when it is not installed. */
async function optional<T>(name: string): Promise<T | null> {
  try {
    return (await import(name)) as T;
  } catch {
    return null;
  }
}

interface TesseractModule {
  createWorker(langs: string[], oem?: number, options?: Record<string, unknown>): Promise<{
    recognize(image: Buffer): Promise<{ data: { text: string } }>;
    terminate(): Promise<unknown>;
  }>;
}

/** Language data is cached per user, never in the working directory (where tesseract.js puts it by default). */
function defaultCachePath(): string {
  const base = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(base, "guardbee", "tessdata");
}

/**
 * One Tesseract worker for a whole document. Null when tesseract.js is not
 * installed: the caller reports that instead of failing.
 */
async function ocrEngine(options: Required<Pick<ExtractOptions, "languages">> & Pick<ExtractOptions, "langPath" | "cachePath">) {
  const mod = await optional<TesseractModule & { default?: TesseractModule }>("tesseract.js");
  const tesseract = mod?.createWorker ? mod : mod?.default;
  if (!tesseract) return null;
  const cachePath = options.cachePath ?? defaultCachePath();
  mkdirSync(cachePath, { recursive: true });
  const worker = await tesseract.createWorker(options.languages, 1, {
    cachePath,
    ...(options.langPath ? { langPath: options.langPath } : {}),
    logger: () => {},
    errorHandler: () => {},
  });
  const recognize: Recognize = async (image) => (await worker.recognize(Buffer.from(image))).data.text;
  return { recognize, close: () => worker.terminate() };
}

const NO_OCR = "OCR skipped: install tesseract.js to read text in images and scanned PDFs";
const NO_CANVAS = "scanned PDF pages skipped: install @napi-rs/canvas (and tesseract.js) to OCR them";

export async function extractText(input: Uint8Array, options: ExtractOptions = {}): Promise<Extraction> {
  const opts = { ...DEFAULTS, ...options };
  if (input.length > opts.maxBytes) {
    return { kind: detectKind(input.subarray(0, 16)), pages: [], notes: [`not read: ${input.length} bytes is over the ${opts.maxBytes}-byte limit`] };
  }
  const kind = detectKind(input);
  const notes: string[] = [];

  if (kind === "text") return { kind, pages: [{ page: 1, text: new TextDecoder().decode(input), method: "text" }], notes };
  if (kind === "binary") return { kind, pages: [], notes: ["not read: not a PDF, an image or text"] };

  if (kind !== "pdf") {
    if (!opts.ocr) return { kind, pages: [], notes: ["OCR is off"] };
    const engine = await ocrEngine(opts);
    if (!engine) return { kind, pages: [], notes: [NO_OCR] };
    try {
      return { kind, pages: [{ page: 1, text: await engine.recognize(input), method: "ocr" }], notes };
    } finally {
      await engine.close();
    }
  }

  // PDF: the text layer first, OCR only for pages that have none
  const { getDocumentProxy, extractText: pdfText, renderPageAsImage } = await import("unpdf");
  const data = new Uint8Array(input); // pdf.js takes ownership of the buffer
  const pdf = await getDocumentProxy(data);
  const total = pdf.numPages;
  const count = Math.min(total, opts.maxPages);
  if (total > count) notes.push(`only the first ${count} of ${total} pages were read (maxPages)`);
  const { text } = await pdfText(pdf, { mergePages: false });
  const pages: ExtractedPage[] = [];
  const scanned: number[] = [];
  for (let page = 1; page <= count; page++) {
    const layer = (text as string[])[page - 1] ?? "";
    if (layer.replace(/\s/g, "").length >= opts.minTextChars) pages.push({ page, text: layer, method: "pdf-text" });
    else scanned.push(page);
  }

  if (scanned.length > 0 && opts.ocr) {
    const canvas = await optional<object>("@napi-rs/canvas");
    const engine = canvas ? await ocrEngine(opts) : null;
    if (!canvas || !engine) notes.push(!canvas ? NO_CANVAS : NO_OCR);
    else {
      try {
        for (const page of scanned) {
          const image = await renderPageAsImage(new Uint8Array(input), page, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 });
          pages.push({ page, text: await engine.recognize(new Uint8Array(image)), method: "pdf-ocr" });
        }
      } finally {
        await engine.close();
      }
    }
  } else if (scanned.length > 0) {
    notes.push(`${scanned.length} page(s) without a text layer were not read (OCR is off)`);
  }
  pages.sort((a, b) => a.page - b.page);
  return { kind, pages, notes };
}
