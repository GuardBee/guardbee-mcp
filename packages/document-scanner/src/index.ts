export { detectKind, extractText } from "./extract.js";
export type { DocumentKind, ExtractMethod, ExtractOptions, ExtractedPage, Extraction } from "./extract.js";
export { scanBytes, scanFile, scanDirectory } from "./scanner.js";
export type { DocumentResult, DirectoryResult, Finding, ScanOptions, Severity } from "./scanner.js";
export { buildSarif, formatResults, shouldFail } from "./report.js";
