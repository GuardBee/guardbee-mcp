import { parseNpmManifest, type Dependency } from "./parsers/npm.js";
import { parsePipRequirements } from "./parsers/pip.js";
import { parseOtherEcosystems } from "./parsers/other-locks.js";
import { auditDependencies } from "./audit.js";
import { getSeverity, type AuditResult } from "./osv.js";

export interface ProjectAuditOptions {
  /** Include devDependencies / poetry/uv/Pipfile lock groups. Default false. */
  includeDev?: boolean;
}

/**
 * Parse every supported manifest/lockfile under `dir` and query OSV once per
 * name@version. Empty when the directory has no supported manifests.
 */
export async function auditDirectory(dir: string, options: ProjectAuditOptions = {}): Promise<AuditResult[]> {
  const includeDev = options.includeDev ?? false;
  const results: AuditResult[] = [];

  let npm = parseNpmManifest(dir);
  if (!includeDev) npm = npm.filter((d) => !d.isDev);
  if (npm.length > 0) results.push(...(await auditDependencies(npm, "npm")));

  let pip = parsePipRequirements(dir);
  if (!includeDev) pip = pip.filter((d) => !d.isDev);
  if (pip.length > 0) results.push(...(await auditDependencies(pip, "PyPI")));

  for (const { ecosystem, deps: found } of parseOtherEcosystems(dir)) {
    const deps: Dependency[] = includeDev ? found : found.filter((d) => !d.isDev);
    if (deps.length > 0) results.push(...(await auditDependencies(deps, ecosystem)));
  }

  return results;
}

/** Flatten OSV hits into one row per vulnerability for meta-scanners. */
export function vulnsAsFindings(results: AuditResult[]): Array<{
  patternId: string;
  patternName: string;
  severity: "critical" | "high" | "medium" | "low";
  recommendation: string;
  file?: string;
  match: string;
}> {
  const out: Array<{
    patternId: string;
    patternName: string;
    severity: "critical" | "high" | "medium" | "low";
    recommendation: string;
    file?: string;
    match: string;
  }> = [];
  for (const r of results) {
    for (const v of r.vulns) {
      const sev = getSeverity(v);
      out.push({
        patternId: v.id,
        patternName: v.summary ?? `${r.name}@${r.version} vulnerable (${v.id})`,
        severity: sev === "unknown" ? "medium" : sev,
        recommendation: `Upgrade ${r.name}@${r.version} (${r.ecosystem}): ${v.id}${v.summary ? ` — ${v.summary}` : ""}`,
        file: r.file,
        match: `${r.name}@${r.version} ${v.id}`,
      });
    }
  }
  return out;
}
