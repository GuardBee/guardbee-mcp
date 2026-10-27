import { OrgPatterns, PII_PRESETS, PiiScope, piiScope, type OrgPatternConfig, type PiiPresetName, type PiiSelection } from "@guardbee/guard-core";

/** The piiMasking fields that pick detectors (policy file or dashboard policy). */
export interface PiiMaskingSelection extends PiiSelection, OrgPatternConfig {
  include?: readonly string[];
  upstreams?: Record<string, { preset?: PiiPresetName; enable?: readonly string[]; disable?: readonly string[] }>;
}

/** What one upstream masks, and what it still detects (for taint and piiHits). */
export interface PiiScopes {
  /** Detectors whose values are masked or tokenized. */
  mask: PiiScope;
  /** The default detectors plus whatever `mask` adds: masking narrows, detection does not. */
  detect: PiiScope;
}

const DEFAULT_KEY = "";
const NO_MASKING = {};
// Keyed by the piiMasking object: a dashboard policy update brings a new one.
const cache = new WeakMap<object, Map<string, PiiScopes>>();

/**
 * piiMasking's preset / enable / disable, or the override for this upstream
 * (or LLM provider). The legacy `include` list enables opt-in detectors for
 * every upstream.
 */
export function piiScopesFor(masking: PiiMaskingSelection | undefined, upstream?: string): PiiScopes {
  const owner = masking ?? NO_MASKING;
  let byUpstream = cache.get(owner);
  if (!byUpstream) cache.set(owner, (byUpstream = new Map()));
  const override = upstream !== undefined ? masking?.upstreams?.[upstream] : undefined;
  const key = override ? upstream! : DEFAULT_KEY;
  let scopes = byUpstream.get(key);
  if (!scopes) {
    const selection = override ?? masking ?? {};
    const mask = piiScope({
      ...(selection.preset ? { preset: selection.preset } : {}),
      enable: [...(masking?.include ?? []), ...(selection.enable ?? [])],
      ...(selection.disable ? { disable: selection.disable } : {}),
    });
    scopes = { mask, detect: new PiiScope([...PII_PRESETS.ALL, ...mask]) };
    byUpstream.set(key, scopes);
  }
  return scopes;
}

const NO_PATTERNS = OrgPatterns.compile();
const compiled = new WeakMap<object, OrgPatterns>();

/** piiMasking's block and allow patterns, compiled once per policy (validated with it). */
export function orgPatternsFor(masking: PiiMaskingSelection | undefined): OrgPatterns {
  if (!masking || (!masking.blockPatterns?.length && !masking.allowPatterns?.length)) return NO_PATTERNS;
  let org = compiled.get(masking);
  if (!org) compiled.set(masking, (org = OrgPatterns.compile({ blockPatterns: masking.blockPatterns ?? [], allowPatterns: masking.allowPatterns ?? [] })));
  return org;
}
