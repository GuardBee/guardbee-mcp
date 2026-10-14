import { readFileSync, readdirSync, statSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { PERSONAL_DATA_CATEGORIES, maskPiiInText } from "@guardbee/guard-core";
import { extractText, type DocumentKind, type ExtractMethod, type ExtractOptions } from "./extract.js";

export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  /** guard-core detector name: tc_kimlik, iban, passport, github_pat, private_key, … */
  detector: string;
  category: "personal" | "credential";
  severity: Severity;
  /** File path (or a label for bytes) and page. */
  location: string;
  page: number;
  /** How the text was read: a text layer, or OCR. */
  method: ExtractMethod;
  /** The first and last characters only. */
  maskedMatch: string;
}

export interface DocumentResult {
  location: string;
  kind: DocumentKind;
  findings: Finding[];
  pagesRead: number;
  notes: string[];
}

export interface ScanOptions extends ExtractOptions {
  /** Opt-in detectors to also run: ip_address, mac_address, plate_tr. */
  include?: string[];
}

const PERSONAL = new Set<string>(PERSONAL_DATA_CATEGORIES);
/** Identifiers that on their own let someone be found or charged. */
const HIGH_PERSONAL = new Set(["tc_kimlik", "iban", "credit_card", "passport", "sgk_no"]);

function severityOf(detector: string): Severity {
  if (!PERSONAL.has(detector)) return detector === "private_key" ? "critical" : "high";
  return HIGH_PERSONAL.has(detector) ? "high" : "medium";
}

function mask(match: string): string {
  const value = match.replace(/\s+/g, " ").trim();
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}

/** PII and credentials in a document's bytes. */
export async function scanBytes(bytes: Uint8Array, location = "<input>", options: ScanOptions = {}): Promise<DocumentResult> {
  const extraction = await extractText(bytes, options);
  const include = options.include?.length ? new Set(options.include) : undefined;
  const findings: Finding[] = [];
  for (const page of extraction.pages) {
    maskPiiInText(
      page.text,
      (detector, match) => {
        findings.push({
          detector,
          category: PERSONAL.has(detector) ? "personal" : "credential",
          severity: severityOf(detector),
          location,
          page: page.page,
          method: page.method,
          maskedMatch: mask(match),
        });
        return "";
      },
      include,
    );
  }
  return { location, kind: extraction.kind, findings, pagesRead: extraction.pages.length, notes: extraction.notes };
}

export async function scanFile(path: string, options: ScanOptions = {}): Promise<DocumentResult> {
  return scanBytes(new Uint8Array(readFileSync(path)), path, options);
}

/** The same as a whole: documents scanned in a folder (PDFs and images only by default). */
export interface DirectoryResult {
  documents: DocumentResult[];
  findings: Finding[];
  durationMs: number;
}

/** Relative to the working directory when inside it, the full path otherwise. */
function shown(file: string): string {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : resolve(file);
}

const DOCUMENT_EXT = /\.(pdf|png|jpe?g|gif|webp|bmp|tiff?)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

export async function scanDirectory(
  root: string,
  options: ScanOptions & { maxFiles?: number; includeText?: boolean } = {},
): Promise<DirectoryResult> {
  const started = Date.now();
  const files: string[] = [];
  const maxFiles = options.maxFiles ?? 500;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= maxFiles) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && (DOCUMENT_EXT.test(entry.name) || (options.includeText && /\.(txt|md|csv)$/i.test(entry.name)))) {
        files.push(full);
      }
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  else files.push(root);

  const documents: DocumentResult[] = [];
  for (const file of files) {
    const result = await scanFile(file, options).catch(
      (err: unknown): DocumentResult => ({ location: file, kind: "binary", findings: [], pagesRead: 0, notes: [`not read: ${err instanceof Error ? err.message : String(err)}`] }),
    );
    const location = shown(file);
    documents.push({ ...result, location, findings: result.findings.map((f) => ({ ...f, location })) });
  }
  return { documents, findings: documents.flatMap((d) => d.findings), durationMs: Date.now() - started };
}
