import { gradeBelow, loadMcpIndex, lookupMcpGrade, parseLaunch, type LoadMcpIndexOptions, type McpGrade, type McpIndex, type McpIndexMatch } from "@guardbee/guard-core";
import type { ConfigFinding, ParsedServer } from "./types.js";

/**
 * GuardBee MCP Index grades for configured servers. The whole index is
 * downloaded (and cached for a day) and searched locally: no server name or
 * package leaves the machine.
 */

export interface ServerGrade {
  server: string;
  file?: string;
  /** What the command launches: `npm:name@spec`, `pypi:name`, `oci:image`; undefined for a local command or a URL. */
  artifact?: string;
  grade: McpGrade | null;
  score?: number;
  /** Why there is no grade, or what the grade rests on. */
  note: string;
  /** Registry entry the grade belongs to. */
  indexName?: string;
  sameVersion?: boolean;
}

export function gradeServer(index: McpIndex, server: ParsedServer, file?: string): ServerGrade {
  const base = { server: server.name, ...(file ? { file } : {}) };
  if (server.url) return { ...base, grade: null, note: "remote server: the index grades published packages" };
  const target = server.command ? parseLaunch(server.command, server.args) : undefined;
  if (!target) return { ...base, grade: null, note: "local command: not a registry package" };
  const artifact = target.ecosystem === "oci" ? `oci:${target.reference}` : `${target.ecosystem}:${target.name}${target.spec ? `@${target.spec}` : ""}`;
  const match: McpIndexMatch | undefined = lookupMcpGrade(index, target);
  if (!match) return { ...base, artifact, grade: null, note: "not in the MCP Index (not in the official registry)" };
  if (match.entry.grade === null) return { ...base, artifact, grade: null, indexName: match.entry.name, note: match.entry.note ?? "not graded" };
  const graded = `${match.package.identifier}@${match.package.version ?? "?"}`;
  return {
    ...base,
    artifact,
    grade: match.entry.grade,
    ...(match.entry.score !== null ? { score: match.entry.score } : {}),
    indexName: match.entry.name,
    sameVersion: match.sameVersion,
    note: match.sameVersion ? `graded ${graded}` : `graded ${graded} (the config runs ${target.ecosystem === "oci" ? target.reference : target.spec || "the latest version"})`,
  };
}

export async function loadIndexForGrades(options: LoadMcpIndexOptions = {}): Promise<McpIndex> {
  const loaded = await loadMcpIndex(options);
  if (!loaded) throw new Error(options.offline ? "no cached MCP Index (run once without --offline)" : "could not download the GuardBee MCP Index");
  if (loaded.source === "stale-cache") process.stderr.write("[guardbee] MCP Index download failed; using an older cached copy\n");
  return loaded.index;
}

/** A finding for every graded server below `minimum`. Ungraded servers are not findings: the grade column says why. */
export function gradeFindings(grades: ServerGrade[], minimum: McpGrade): ConfigFinding[] {
  return grades
    .filter((g): g is ServerGrade & { grade: McpGrade } => g.grade !== null && gradeBelow(g.grade, minimum))
    .map((g) => ({
      patternId: "mcp_index_grade_below_minimum",
      patternName: `MCP Index grade ${g.grade} is below the minimum ${minimum}`,
      category: "supply-chain",
      severity: g.grade === "F" ? "critical" : "high",
      owasp: "MCP04:2025",
      recommendation: `The GuardBee MCP Index grades ${g.indexName} ${g.grade}${g.score !== undefined ? ` (${g.score}/100)` : ""}. See the reasons at https://guardbee.github.io/guardbee-mcp/?q=${encodeURIComponent(g.indexName ?? g.server)} before running it, or replace it.`,
      server: g.server,
      ...(g.file ? { file: g.file } : {}),
      line: 1,
      column: 1,
      match: `${g.server}: ${g.artifact ?? ""} → ${g.grade}`,
    }));
}

export function formatGrades(grades: ServerGrade[]): string {
  if (!grades.length) return "No servers to grade.";
  const width = Math.max(...grades.map((g) => g.server.length), 6);
  return ["MCP Index grades:", ...grades.map((g) => `  ${(g.grade ?? "–").padEnd(2)} ${g.server.padEnd(width)}  ${g.artifact ?? ""}${g.artifact ? "  " : ""}${g.note}`)].join("\n");
}
