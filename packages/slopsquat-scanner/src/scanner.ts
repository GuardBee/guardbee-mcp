import { parseNpmDirectDependencies } from "./parsers/npm.js";
import { parsePipDirectDependencies } from "./parsers/pip.js";
import { checkNpmPackage, checkPyPIPackage, checkPackagesConcurrently, type Ecosystem } from "./registry.js";

/** Below this age, an existing package is flagged as low-severity: could be a brand-new legitimate release, or a name pre-registered by an attacker anticipating a specific LLM hallucination ("slopsquatting"). Not definitive either way — informational. */
const RECENTLY_PUBLISHED_DAYS = 30;

export interface Finding {
  patternId: "dependency_not_found" | "dependency_recently_published";
  patternName: string;
  ecosystem: Ecosystem;
  severity: "critical" | "low";
  packageName: string;
  isDev: boolean;
  ageDays?: number;
  recommendation: string;
}

export interface ScanResult {
  ecosystem: Ecosystem;
  packagesChecked: number;
  findings: Finding[];
  durationMs: number;
}

export function toFinding(
  name: string,
  isDev: boolean,
  ecosystem: Ecosystem,
  exists: boolean,
  ageDays: number | undefined
): Finding | null {
  if (!exists) {
    return {
      patternId: "dependency_not_found",
      patternName: `Declared ${ecosystem} dependency does not exist on the real registry`,
      ecosystem,
      severity: "critical",
      packageName: name,
      isDev,
      recommendation:
        "This exact package name isn't published on the registry at all. If this line was written or suggested by an AI coding assistant, this is very likely a hallucinated dependency — LLMs invent plausible-sounding package names at a measurable rate, and attackers pre-register those exact names ('slopsquatting') so the next person who copies the same suggestion installs their code instead. Verify the correct package name before installing; if you intended this name, register it yourself before someone else does.",
    };
  }
  if (ageDays !== undefined && ageDays < RECENTLY_PUBLISHED_DAYS) {
    return {
      patternId: "dependency_recently_published",
      patternName: `${ecosystem} dependency was first published very recently`,
      ecosystem,
      severity: "low",
      packageName: name,
      isDev,
      ageDays,
      recommendation: `This package exists, but its oldest release is only ${ageDays} day(s) old. That's routine for a real new project -- it's also the exact shape of a slopsquat registered just ahead of an expected LLM hallucination. Not a finding on its own; worth a quick look at who published it and how many other projects depend on it before trusting it in anything that reaches production.`,
    };
  }
  return null;
}

export async function scanNpm(dir: string): Promise<ScanResult> {
  const start = Date.now();
  const deps = parseNpmDirectDependencies(dir);
  const checks = await checkPackagesConcurrently(deps, (d) => checkNpmPackage(d.name));

  const findings: Finding[] = [];
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    const check = checks[i];
    if (!dep || !check) continue;
    const f = toFinding(dep.name, dep.isDev, "npm", check.exists, check.ageDays);
    if (f) findings.push(f);
  }

  return { ecosystem: "npm", packagesChecked: deps.length, findings, durationMs: Date.now() - start };
}

export async function scanPip(dir: string): Promise<ScanResult> {
  const start = Date.now();
  const deps = parsePipDirectDependencies(dir);
  const checks = await checkPackagesConcurrently(deps, (d) => checkPyPIPackage(d.name));

  const findings: Finding[] = [];
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    const check = checks[i];
    if (!dep || !check) continue;
    const f = toFinding(dep.name, dep.isDev, "PyPI", check.exists, check.ageDays);
    if (f) findings.push(f);
  }

  return { ecosystem: "PyPI", packagesChecked: deps.length, findings, durationMs: Date.now() - start };
}

export async function checkSinglePackage(name: string, ecosystem: Ecosystem): Promise<Finding | null> {
  const check = ecosystem === "npm" ? await checkNpmPackage(name) : await checkPyPIPackage(name);
  return toFinding(name, false, ecosystem, check.exists, check.ageDays);
}
