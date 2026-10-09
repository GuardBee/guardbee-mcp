export { scanText, scanFile, scanDirectory } from "./scanner.js";
export { SECRET_PATTERNS } from "./patterns.js";
export type { Finding, ScanResult } from "./scanner.js";
export type { SecretPattern } from "./patterns.js";
export { fingerprintOf } from "./scanner.js";
export { scanGit } from "./git.js";
export type { GitScanOptions, GitScanResult } from "./git.js";
export { applyBaseline, readBaseline, toBaseline, writeBaseline } from "./baseline.js";
export type { Baseline } from "./baseline.js";
