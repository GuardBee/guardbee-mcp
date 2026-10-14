export {
  getEngine,
  evaluateEvent,
  buildEvent,
  buildSarif,
  listLoadedRules,
  ruleStats,
  shouldFail,
  fieldsForEventType,
  listYamlFiles,
  projectRulesDirs,
  resetEngineCache,
  readTextFile,
  GUARDBEE_CATEGORY_HINTS,
} from "./engine.js";
export type { EvaluateResult, EngineOptions, FormattedMatch, Lane } from "./engine.js";
// GuardBee audit events → OWASP Top 10 for LLM Applications and MITRE ATLAS (kept in guard-core, shared with the proxy's reports)
export { OWASP_LLM, MITRE_ATLAS, THREAT_CATEGORIES, classifyEvent } from "@guardbee/guard-core";
export type { FrameworkRef, ThreatCategory, ThreatCategoryKey } from "@guardbee/guard-core";
