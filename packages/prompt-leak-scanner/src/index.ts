export { scanText, scanAndRedactText, scanBody, redactBody, scanFile, scanDirectory } from "./scanner.js";
export type { Finding, ScanResult } from "./scanner.js";
export { LEAK_PATTERNS } from "./patterns.js";
export type { LeakPattern, LeakCategory } from "./patterns.js";
export { startProxy } from "./proxy.js";
export type { ProxyOptions, ProxyMode, AuditEvent } from "./proxy.js";
