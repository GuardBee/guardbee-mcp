import fs from "fs";
import os from "os";
import path from "path";
import { parseImageReference, type LaunchTarget } from "./provenance.js";

/**
 * The GuardBee MCP Index: an A–F trust grade for every server in the
 * official MCP Registry, rebuilt weekly from the packages themselves (static
 * scan, known vulnerabilities and malware, build provenance, maintenance
 * signals). See packages/mcp-index/RUBRIC.md for how a grade is made.
 *
 * Lookups are local: the whole index is downloaded and searched here, so
 * which servers you run never leaves the machine.
 */

export type McpGrade = "A" | "B" | "C" | "D" | "F";

export const MCP_GRADES: readonly McpGrade[] = ["A", "B", "C", "D", "F"];

export const DEFAULT_MCP_INDEX_URL = "https://guardbee.github.io/guardbee-mcp/index/v1.json";

export interface McpIndexReason {
  category: "code" | "supply-chain" | "maintenance";
  id: string;
  /** Points taken off (negative) by this reason. */
  points: number;
  detail: string;
}

export interface McpIndexPackage {
  ecosystem: "npm" | "pypi" | "oci";
  /** npm or PyPI name, or image repository (`ghcr.io/owner/name`). */
  identifier: string;
  version?: string;
}

export interface McpIndexEntry {
  /** Registry name, e.g. `io.github.owner/server`. */
  name: string;
  version: string;
  title?: string;
  description?: string;
  repository?: string;
  packages: McpIndexPackage[];
  /** Has remote (hosted) endpoints. */
  remote: boolean;
  /** Null when the entry could not be graded (remote-only, package unavailable, opted out); `note` says why. */
  grade: McpGrade | null;
  score: number | null;
  subscores?: { code: number; supplyChain: number; maintenance: number };
  reasons: McpIndexReason[];
  scannedAt: string;
  note?: string;
}

export interface McpIndex {
  format: 1;
  rubricVersion: string;
  generatedAt: string;
  servers: McpIndexEntry[];
}

/** True when `grade` is worse than `minimum` (F < D < C < B < A). */
export function gradeBelow(grade: McpGrade, minimum: McpGrade): boolean {
  return MCP_GRADES.indexOf(grade) > MCP_GRADES.indexOf(minimum);
}

export function isMcpGrade(value: string): value is McpGrade {
  return (MCP_GRADES as readonly string[]).includes(value);
}

const normalizePypi = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** An image reference without tag or digest, with its registry: `ghcr.io/owner/name`, `docker.io/library/node`. */
export function imageRepository(reference: string): string | undefined {
  const image = parseImageReference(reference);
  return image ? `${image.registry}/${image.repository}`.toLowerCase() : undefined;
}

export interface McpIndexMatch {
  entry: McpIndexEntry;
  package: McpIndexPackage;
  /** The configured version is the one that was graded (false: another or a floating version). */
  sameVersion: boolean;
}

/** The index entry for what a command launches (npx / uvx / docker run …); undefined when it is not in the index. */
export function lookupMcpGrade(index: McpIndex, target: LaunchTarget): McpIndexMatch | undefined {
  const wanted =
    target.ecosystem === "npm"
      ? { ecosystem: "npm", id: target.name, version: target.spec }
      : target.ecosystem === "pypi"
        ? { ecosystem: "pypi", id: normalizePypi(target.name), version: target.spec }
        : { ecosystem: "oci", id: imageRepository(target.reference), version: parseImageReference(target.reference)?.tag };
  if (!wanted.id) return undefined;
  let best: McpIndexMatch | undefined;
  for (const entry of index.servers) {
    for (const pkg of entry.packages) {
      if (pkg.ecosystem !== wanted.ecosystem) continue;
      const id = pkg.ecosystem === "pypi" ? normalizePypi(pkg.identifier) : pkg.ecosystem === "oci" ? imageRepository(pkg.identifier) : pkg.identifier;
      if (id !== wanted.id) continue;
      const match = { entry, package: pkg, sameVersion: !!wanted.version && wanted.version === pkg.version };
      // Several registry entries can ship one package: prefer a graded one, then the most recent scan
      if (!best || (best.entry.grade === null && entry.grade !== null) || (entry.grade !== null && entry.scannedAt > best.entry.scannedAt)) best = match;
    }
  }
  return best;
}

export interface LoadMcpIndexOptions {
  url?: string;
  /** Default ~/.guardbee/mcp-index.json. */
  cacheFile?: string;
  /** Use a cached copy younger than this; default 24 hours. */
  maxAgeMs?: number;
  /** Never download: the cache or nothing. */
  offline?: boolean;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

export interface LoadedMcpIndex {
  index: McpIndex;
  source: "network" | "cache" | "stale-cache";
}

function validIndex(value: unknown): value is McpIndex {
  const v = value as Partial<McpIndex> | null;
  return !!v && v.format === 1 && Array.isArray(v.servers) && typeof v.rubricVersion === "string";
}

/**
 * The index, from the cache when it is fresh, otherwise downloaded (a
 * failed download falls back to an older cached copy). Undefined when
 * neither is available.
 */
export async function loadMcpIndex(options: LoadMcpIndexOptions = {}): Promise<LoadedMcpIndex | undefined> {
  const cacheFile = options.cacheFile ?? path.join(os.homedir(), ".guardbee", "mcp-index.json");
  const now = options.now ?? Date.now;
  let cached: McpIndex | undefined;
  let age = Infinity;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (validIndex(parsed)) {
      cached = parsed;
      age = now() - fs.statSync(cacheFile).mtimeMs;
    }
  } catch {
    // no cache yet
  }
  if (cached && (options.offline || age < (options.maxAgeMs ?? 24 * 3600_000))) return { index: cached, source: "cache" };
  if (options.offline) return undefined;
  try {
    const response = await (options.fetch ?? fetch)(options.url ?? DEFAULT_MCP_INDEX_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed: unknown = await response.json();
    if (!validIndex(parsed)) throw new Error("not a GuardBee MCP Index (format 1)");
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(parsed));
    return { index: parsed, source: "network" };
  } catch {
    return cached ? { index: cached, source: "stale-cache" } : undefined;
  }
}
