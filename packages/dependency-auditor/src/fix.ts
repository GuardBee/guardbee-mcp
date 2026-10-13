import type { AuditResult, OsvVuln } from "./osv.js";
import { compareVersions } from "./version.js";

type RangeEvent = { introduced?: string; fixed?: string; last_affected?: string; limit?: string };

function sameName(a: string, b: string, ecosystem: string): boolean {
  if (ecosystem === "PyPI") {
    const n = (s: string) => s.toLowerCase().replace(/[-_.]+/g, "-");
    return n(a) === n(b);
  }
  return a.toLowerCase() === b.toLowerCase();
}

function eventVersion(e: RangeEvent): string {
  return e.introduced ?? e.fixed ?? e.last_affected ?? e.limit ?? "";
}

/** The vulnerability's version ranges for this package, ignoring GIT (commit) ranges. */
function rangesFor(vuln: OsvVuln, name: string, ecosystem: string) {
  return (vuln.affected ?? [])
    .filter((a) => sameName(a.package.name, name, ecosystem))
    .map((a) => ({
      versions: a.versions ?? [],
      ranges: (a.ranges ?? []).filter((r) => r.type !== "GIT").map((r) => sortEvents(r.events, ecosystem)),
    }));
}

function sortEvents(events: RangeEvent[], ecosystem: string): RangeEvent[] {
  return [...events].sort((x, y) => {
    const vx = eventVersion(x);
    const vy = eventVersion(y);
    if (vx === "0" || vy === "0") return vx === vy ? 0 : vx === "0" ? -1 : 1;
    return compareVersions(vx, vy, ecosystem);
  });
}

/** OSV range evaluation: walk the sorted events up to `version`. */
function inRange(events: RangeEvent[], version: string, ecosystem: string): boolean {
  let affected = false;
  for (const e of events) {
    if (e.introduced !== undefined) {
      if (e.introduced === "0" || compareVersions(version, e.introduced, ecosystem) >= 0) affected = true;
    } else if (e.fixed !== undefined) {
      if (compareVersions(version, e.fixed, ecosystem) >= 0) affected = false;
    } else if (e.last_affected !== undefined) {
      if (compareVersions(version, e.last_affected, ecosystem) > 0) affected = false;
    }
  }
  return affected;
}

export function isAffected(vuln: OsvVuln, name: string, version: string, ecosystem: string): boolean {
  return rangesFor(vuln, name, ecosystem).some(
    (a) => a.versions.includes(version) || a.ranges.some((events) => inRange(events, version, ecosystem))
  );
}

/** Write a fix the way the installed version is written: Go and Composer use a "v" prefix (v0.10.0), OSV often does not. */
function styleLike(installed: string, fixed: string): string {
  return /^v\d/.test(installed) && /^\d/.test(fixed) ? `v${fixed}` : fixed;
}

function fixedEventsAbove(vuln: OsvVuln, name: string, version: string, ecosystem: string): string[] {
  return rangesFor(vuln, name, ecosystem)
    .flatMap((a) => a.ranges.flat())
    .flatMap((e) =>
      e.fixed !== undefined && compareVersions(e.fixed, version, ecosystem) > 0 ? [styleLike(version, e.fixed)] : []
    );
}

/**
 * Lowest version above `version` that this advisory no longer affects, or
 * null if none is listed. Considers every `fixed` event, so a release on
 * another branch (e.g. 4.24.15 for a 5.0.0 beta) is only chosen when it
 * really is above the installed version and outside every affected range.
 */
export function getFixedVersion(
  vuln: OsvVuln,
  name: string,
  version?: string,
  ecosystem: string = "npm"
): string | null {
  if (version === undefined) {
    // Pre-0.4 signature without the installed version: first listed fix.
    for (const a of rangesFor(vuln, name, ecosystem)) {
      for (const e of a.ranges.flat()) if (e.fixed) return e.fixed;
    }
    return null;
  }
  const candidates = fixedEventsAbove(vuln, name, version, ecosystem).sort((a, b) =>
    compareVersions(a, b, ecosystem)
  );
  return candidates.find((c) => !isAffected(vuln, name, c, ecosystem)) ?? null;
}

/** Leading numeric segment ("v2.3" → "2", "2!1.0" → "2!1"); 0.x minors count as majors, as in SemVer. */
function majorOf(v: string): string {
  const m = /^v?(?:(\d+)!)?(\d+)(?:\.(\d+))?/.exec(v);
  if (!m) return v;
  const epoch = m[1] ? `${m[1]}!` : "";
  return m[2] === "0" ? `${epoch}0.${m[3] ?? ""}` : `${epoch}${m[2]}`;
}

export interface UpgradePlan {
  /** Smallest listed version that fixes the most advisories, or null when none is listed. */
  version: string | null;
  /** The upgrade crosses a major version (may contain breaking changes). */
  major: boolean;
  fixes: number;
  total: number;
  /** Advisories still open at `version` (no fix listed, or fixed only later). */
  unfixed: string[];
}

/**
 * One upgrade per package: the smallest fixed version, among those listed by
 * the package's advisories, that is outside every advisory's affected range.
 * If no listed version clears all of them, the one that clears the most.
 */
export function planUpgrade(result: AuditResult): UpgradePlan {
  const { name, version, ecosystem, vulns } = result;
  const candidates = [...new Set(vulns.flatMap((v) => fixedEventsAbove(v, name, version, ecosystem)))].sort(
    (a, b) => compareVersions(a, b, ecosystem)
  );

  let best: UpgradePlan = { version: null, major: false, fixes: 0, total: vulns.length, unfixed: vulns.map((v) => v.id) };
  for (const c of candidates) {
    const open = vulns.filter((v) => isAffected(v, name, c, ecosystem));
    const fixes = vulns.length - open.length;
    if (fixes > best.fixes) {
      best = { version: c, major: majorOf(c) !== majorOf(version), fixes, total: vulns.length, unfixed: open.map((v) => v.id) };
    }
    if (open.length === 0) break;
  }
  return best;
}
