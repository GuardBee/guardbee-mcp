import { readFileSync, writeFileSync } from "fs";
import type { Finding } from "./scanner.js";

/**
 * Findings someone has already looked at. A repository with old secrets can
 * adopt the scanner in CI by writing a baseline once; later runs report only
 * what is new. The file holds fingerprints (hashes) and locations, never the
 * secrets, so it is safe to commit.
 */
export interface Baseline {
  version: 1;
  generatedAt: string;
  findings: { fingerprint: string; patternId: string; file?: string; line: number; commit?: string }[];
}

export function toBaseline(findings: Finding[], now = new Date()): Baseline {
  const seen = new Set<string>();
  const entries: Baseline["findings"] = [];
  for (const f of findings) {
    if (seen.has(f.fingerprint)) continue;
    seen.add(f.fingerprint);
    entries.push({
      fingerprint: f.fingerprint,
      patternId: f.patternId,
      ...(f.file ? { file: f.file.replace(/\\/g, "/") } : {}),
      line: f.line,
      ...(f.commit ? { commit: f.commit } : {}),
    });
  }
  entries.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? "") || a.line - b.line);
  return { version: 1, generatedAt: now.toISOString(), findings: entries };
}

export function writeBaseline(path: string, findings: Finding[]): Baseline {
  const baseline = toBaseline(findings);
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

export function readBaseline(path: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read baseline ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const findings = (parsed as Partial<Baseline>)?.findings;
  if ((parsed as Partial<Baseline>)?.version !== 1 || !Array.isArray(findings)) {
    throw new Error(`${path} is not a GuardBee secrets baseline (version 1)`);
  }
  return new Set(findings.map((entry) => entry.fingerprint).filter((fp): fp is string => typeof fp === "string"));
}

/** Drop findings already in the baseline. */
export function applyBaseline(findings: Finding[], known: Set<string>): { findings: Finding[]; suppressed: number } {
  const fresh = findings.filter((f) => !known.has(f.fingerprint));
  return { findings: fresh, suppressed: findings.length - fresh.length };
}
