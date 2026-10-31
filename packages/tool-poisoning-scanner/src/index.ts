export { scanText, scanFile, scanDirectory, extractToolBlocks } from "./scanner.js";
export type { Finding, ScanResult } from "./scanner.js";
export { scanToolCatalog, matchSurface } from "./catalog.js";
export type { CatalogFinding, CatalogTool } from "./catalog.js";
export { DESCRIPTION_INJECTION_PATTERNS, MISMATCH_SINK_RULES, READ_ONLY_HINT } from "./patterns.js";
export type { DescriptionInjectionPattern, MismatchSinkRule, ToolPoisoningCategory } from "./patterns.js";
export { registerTools } from "./server.js";
export { judgeFiles, judgeText } from "./judge.js";
export type { JudgeScanOptions } from "./judge.js";
