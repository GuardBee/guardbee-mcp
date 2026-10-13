export { startServer } from "./server.js";
export { queryOsvBatch, getSeverity, getFixedVersion } from "./osv.js";
export type { OsvVuln, AuditResult, Ecosystem } from "./osv.js";
export { parseNpmManifest } from "./parsers/npm.js";
export type { Dependency } from "./parsers/npm.js";
export { parsePipRequirements } from "./parsers/pip.js";
export { planUpgrade, isAffected } from "./fix.js";
export type { UpgradePlan } from "./fix.js";
export { compareVersions } from "./version.js";
