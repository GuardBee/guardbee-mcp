import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { AI_CODE_PATTERNS, type AiCodePattern, type PatternCategory } from "./patterns.js";

// ── Custom rule packs ──────────────────────────────────────────────────────────
//
// Built-in patterns cover common AI/LLM integration mistakes, but KVKK/GDPR
// field names, internal tool names, and org-specific conventions vary per
// customer. Rather than forking the package for every custom rule, a project
// can drop JSON rule files into a directory (default: .guardbee/rules/) that
// get merged in at scan time — same idea as an ESLint custom-rules dir.
//
// Each file is either one rule object or an array of them:
//
//   { "id": "kvkk_tc_kimlik_in_prompt",
//     "name": "TC Kimlik No interpolated into an LLM prompt",
//     "category": "data-privacy",
//     "pattern": "\\btcKimlikNo\\b",
//     "flags": "gi",
//     "severity": "high",
//     "recommendation": "Mask the national ID before it enters the prompt." }

const CATEGORIES: readonly PatternCategory[] = [
  "client-exposure",
  "output-handling",
  "excessive-agency",
  "data-privacy",
  "prompt-injection",
  "cost-control",
];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export interface CustomPatternResult {
  patterns: AiCodePattern[];
  /** Human-readable problems found while loading — callers decide how to surface these. */
  errors: string[];
}

function compileRule(raw: unknown, sourceFile: string): AiCodePattern | string {
  if (typeof raw !== "object" || raw === null) {
    return `${sourceFile}: rule entry is not an object`;
  }
  const r = raw as Record<string, unknown>;

  for (const field of ["id", "name", "category", "pattern", "severity", "recommendation"]) {
    if (typeof r[field] !== "string" || (r[field] as string).length === 0) {
      return `${sourceFile}: rule missing required string field "${field}"`;
    }
  }
  if (!CATEGORIES.includes(r.category as PatternCategory)) {
    return `${sourceFile}: rule "${r.id}" has unknown category "${String(r.category)}"`;
  }
  if (!SEVERITIES.includes(r.severity as (typeof SEVERITIES)[number])) {
    return `${sourceFile}: rule "${r.id}" has unknown severity "${String(r.severity)}"`;
  }

  const flags = typeof r.flags === "string" ? r.flags : "g";
  let pattern: RegExp;
  try {
    pattern = new RegExp(r.pattern as string, flags.includes("g") ? flags : `${flags}g`);
  } catch (err) {
    return `${sourceFile}: rule "${r.id}" has an invalid regex — ${(err as Error).message}`;
  }

  return {
    id: r.id as string,
    name: r.name as string,
    category: r.category as PatternCategory,
    pattern,
    severity: r.severity as AiCodePattern["severity"],
    recommendation: r.recommendation as string,
  };
}

/**
 * Loads and validates custom rule files from `rulesDir` (non-recursive, `*.json` only).
 * Never throws — unreadable/invalid entries are reported in `errors` and skipped.
 * A custom rule reusing a built-in id (or another custom file's id) is rejected
 * rather than silently shadowing it.
 */
export function loadCustomPatterns(rulesDir: string): CustomPatternResult {
  const patterns: AiCodePattern[] = [];
  const errors: string[] = [];
  const seenIds = new Set(AI_CODE_PATTERNS.map((p) => p.id));

  let files: string[];
  try {
    files = readdirSync(rulesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { patterns, errors };
  }

  for (const file of files) {
    const fullPath = join(rulesDir, file);
    let entries: unknown[];
    try {
      const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as unknown;
      entries = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      errors.push(`${fullPath}: invalid JSON — ${(err as Error).message}`);
      continue;
    }

    for (const entry of entries) {
      const result = compileRule(entry, fullPath);
      if (typeof result === "string") {
        errors.push(result);
        continue;
      }
      if (seenIds.has(result.id)) {
        errors.push(`${fullPath}: rule id "${result.id}" collides with an existing pattern — skipped`);
        continue;
      }
      seenIds.add(result.id);
      patterns.push(result);
    }
  }

  return { patterns, errors };
}
