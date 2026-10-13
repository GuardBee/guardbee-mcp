import { queryOsvBatch, type AuditResult, type Ecosystem } from "./osv.js";
import type { Dependency } from "./parsers/npm.js";

/**
 * Query OSV once per name@version (lockfiles can list one release at several
 * install paths) and carry the shortest dependency path onto each result.
 */
export async function auditDependencies(deps: Dependency[], ecosystem: Ecosystem): Promise<AuditResult[]> {
  const unique = new Map<string, Dependency>();
  for (const d of deps) {
    const key = `${d.name}@${d.version}`;
    const prev = unique.get(key);
    if (!prev || (d.path && (!prev.path || d.path.length < prev.path.length))) unique.set(key, d);
  }
  const list = [...unique.values()];
  const results = await queryOsvBatch(list.map((d) => ({ name: d.name, version: d.version, ecosystem })));
  return results.map((r, i) => {
    const path = list[i]!.path;
    return path ? { ...r, path } : r;
  });
}
