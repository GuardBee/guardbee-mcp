// The catalog scan lives in guard-core so security-proxy can apply it to live tools/list results.
export { annotationContradicts, matchSurface, scanToolCatalog } from "@guardbee/guard-core";
export type { CatalogFinding, CatalogTool, SurfaceHit } from "@guardbee/guard-core";
