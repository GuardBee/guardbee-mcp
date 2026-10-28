import { readFileSync, writeFileSync } from "fs";
import { grade } from "./finding.js";
import type { Finding } from "./finding.js";
import type { ScanResult } from "./scanner.js";

export interface Baseline {
  tool: "reverse-shield";
  version: 1;
  createdAt: string;
  grade: ScanResult["grade"];
  fingerprints: string[];
}

export interface BaselineDiff {
  /** Findings not in the baseline: what this build newly gives away. */
  added: Finding[];
  /** Baseline fingerprints no longer found: exposures this build closed. */
  fixed: string[];
  unchanged: Finding[];
  previousGrade: ScanResult["grade"];
}

/**
 * Where a finding lives, stable across builds: relative to the scanned
 * target, with content hashes (index-3f9a8b2c.js, 7321-dd7cb90a7de65945.js,
 * main.a1b2c3d4.chunk.js) and query strings replaced, so the same exposure
 * in the next build matches instead of showing up as new.
 */
export function normalizeLocation(file: string | undefined, target: string): string {
  if (!file) return "";
  let p = file.split("?")[0].replace(/\\/g, "/");
  let root = target.replace(/\\/g, "/");
  while (root.endsWith("/")) root = root.slice(0, -1);
  if (root && p.startsWith(root)) p = p.slice(root.length).replace(/^\/+/, "");
  return p
    .split("/")
    .map((seg) => seg.split(/([.\-_])/).map((t) => (isContentHash(t) ? "#" : t)).join(""))
    .join("/");
}

/** 8–20 alphanumerics that mix digits and letters, or are all caps (esbuild): what bundlers put in file names. */
function isContentHash(token: string): boolean {
  if (!/^[A-Za-z0-9]{8,20}$/.test(token)) return false;
  return (/\d/.test(token) && /[A-Za-z]/.test(token)) || /^[A-Z0-9]+$/.test(token);
}

export function fingerprint(f: Finding, target: string): string {
  // A file can hold several different keys; keep them apart by what was matched (already masked).
  const detail = f.patternId === "bundle_secret" ? `|${f.match.split(" — ")[0]}` : "";
  return `${f.patternId}|${normalizeLocation(f.file, target)}${detail}`;
}

export function createBaseline(result: ScanResult): Baseline {
  return {
    tool: "reverse-shield",
    version: 1,
    createdAt: new Date().toISOString(),
    grade: result.grade,
    fingerprints: [...new Set(result.findings.map((f) => fingerprint(f, result.target)))].sort(),
  };
}

export function readBaseline(path: string): Baseline {
  const data = JSON.parse(readFileSync(path, "utf8")) as Partial<Baseline>;
  if (data.tool !== "reverse-shield" || !Array.isArray(data.fingerprints)) throw new Error(`${path} is not a reverse-shield baseline`);
  return data as Baseline;
}

export function writeBaseline(path: string, result: ScanResult): Baseline {
  const baseline = createBaseline(result);
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

export function compareToBaseline(result: ScanResult, baseline: Baseline): BaselineDiff {
  const known = new Set(baseline.fingerprints);
  const seen = new Set<string>();
  const added: Finding[] = [];
  const unchanged: Finding[] = [];
  for (const f of result.findings) {
    const fp = fingerprint(f, result.target);
    seen.add(fp);
    (known.has(fp) ? unchanged : added).push(f);
  }
  return { added, fixed: baseline.fingerprints.filter((fp) => !seen.has(fp)), unchanged, previousGrade: baseline.grade };
}

/**
 * `ignore` entries from guardbee.yml: a rule id silences it everywhere,
 * `rule:path` only where the location contains `path`. For exposures that
 * are intended (a Firebase web key restricted server-side) or accepted.
 */
export function applyIgnores(result: ScanResult, ignores: string[]): number {
  if (ignores.length === 0) return 0;
  const rules = ignores.map((entry) => {
    const i = entry.indexOf(":");
    return i === -1 ? { id: entry.trim(), path: "" } : { id: entry.slice(0, i).trim(), path: entry.slice(i + 1).trim() };
  });
  const before = result.findings.length;
  result.findings = result.findings.filter((f) => !rules.some((r) => r.id === f.patternId && (r.path === "" || (f.file ?? "").includes(r.path))));
  result.totalFindings = result.findings.length;
  result.grade = grade(result.findings);
  const suppressed = before - result.findings.length;
  if (suppressed > 0) result.notes.push(`${suppressed} finding(s) suppressed by ignore rules`);
  return suppressed;
}
