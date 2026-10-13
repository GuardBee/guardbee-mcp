export { startServer } from "./server.js";
export {
  enumerateDomain,
  enumerateSubdomains,
  enumerateSubdomainsDetailed,
  analyzeSpf,
  analyzeDmarc,
  formatDnsReport,
  formatSubdomainReport,
} from "./dns.js";
export type {
  DnsRecord,
  SpfAnalysis,
  DmarcAnalysis,
  Finding,
  DnsEnumerationResult,
  SubdomainResult,
  SubdomainEnumeration,
  EnumerateOptions,
} from "./dns.js";
export { evaluateSpf, countLookupTerms, isSpfRecord, SPF_LOOKUP_LIMIT, SPF_VOID_LIMIT } from "./spf.js";
export type { SpfEvaluation } from "./spf.js";
export { normalizeDomain, systemResolver } from "./resolver.js";
export type { DnsResolver } from "./resolver.js";
export { checkTakeover, FINGERPRINTS } from "./takeover.js";
export type { TakeoverFinding, Fingerprint, TakeoverOptions } from "./takeover.js";
export { discoverFromCT, normalizeCtName } from "./ct.js";
export type { CtDiscovery, CtOptions, CtSourceResult } from "./ct.js";
