import { checkNpmProvenance, checkPypiProvenance, type BundleVerifier, type McpIndex, type McpIndexEntry, type McpIndexPackage } from "@guardbee/guard-core";
import type { Fetch } from "./http.js";
import { knownIssues } from "./osv.js";
import { listServers, type RegistryServer } from "./registry.js";
import { RUBRIC_VERSION, score, type ProvenanceOutcome } from "./rubric.js";
import { scanFiles } from "./scan.js";
import { npmFacts, pypiFacts } from "./sources.js";

export interface OptOut {
  /** Registry name. */
  name: string;
  reason?: string;
}

export interface CrawlOptions {
  fetch: Fetch;
  verifyBundle: BundleVerifier;
  now?: () => Date;
  optOut?: OptOut[];
}

const ECOSYSTEM: Record<string, McpIndexPackage["ecosystem"] | undefined> = { npm: "npm", pypi: "pypi", oci: "oci" };

function indexPackages(server: RegistryServer): McpIndexPackage[] {
  return (server.packages ?? []).flatMap((p) => {
    const ecosystem = ECOSYSTEM[p.registryType];
    return ecosystem ? [{ ecosystem, identifier: p.identifier, ...(p.version ? { version: p.version } : {}) }] : [];
  });
}

function provenanceOutcome(status: string): ProvenanceOutcome {
  if (status === "verified") return "verified";
  if (status === "unsigned") return "absent";
  if (status === "invalid") return "failed";
  return "unknown";
}

/** One registry entry, graded from its npm or PyPI package. */
export async function gradeServer(server: RegistryServer, options: CrawlOptions): Promise<McpIndexEntry> {
  const now = options.now?.() ?? new Date();
  const packages = indexPackages(server);
  const base = {
    name: server.name,
    version: server.version,
    ...(server.title ? { title: server.title } : {}),
    ...(server.description ? { description: server.description.slice(0, 300) } : {}),
    ...(server.repository?.url ? { repository: server.repository.url } : {}),
    packages,
    remote: (server.remotes ?? []).length > 0,
    scannedAt: now.toISOString(),
  };
  const ungraded = (note: string): McpIndexEntry => ({ ...base, grade: null, score: null, reasons: [], note });

  const optedOut = options.optOut?.find((o) => o.name === server.name);
  if (optedOut) return ungraded(`opted out by the author${optedOut.reason ? `: ${optedOut.reason}` : ""}`);
  const target = packages.find((p) => p.ecosystem === "npm") ?? packages.find((p) => p.ecosystem === "pypi");
  if (!target) {
    if (packages.some((p) => p.ecosystem === "oci")) return ungraded("container image only: images are not graded yet");
    return ungraded(base.remote ? "hosted (remote) server: no package to scan" : "no package in the registry entry");
  }

  try {
    const ecosystem = target.ecosystem as "npm" | "pypi";
    const facts = ecosystem === "npm" ? await npmFacts(options.fetch, target.identifier, target.version) : await pypiFacts(options.fetch, target.identifier, target.version);
    if (!facts) return ungraded(`${ecosystem} package ${target.identifier} not found`);
    target.version = facts.version;
    const [issues, provenance] = await Promise.all([
      knownIssues(options.fetch, ecosystem, facts.name, facts.version),
      (ecosystem === "npm"
        ? checkNpmProvenance(facts.name, facts.version, { verifyBundle: options.verifyBundle, fetch: options.fetch })
        : checkPypiProvenance(facts.name, facts.version, { verifyBundle: options.verifyBundle, fetch: options.fetch })
      ).catch(() => ({ status: "error" as const })),
    ]);
    const result = score({
      facts,
      findings: scanFiles(facts.files),
      issues,
      provenance: provenanceOutcome(provenance.status),
      ...(server.repository?.url ? { registryRepository: server.repository.url } : {}),
      now,
    });
    return { ...base, grade: result.grade, score: result.score, subscores: result.subscores, reasons: result.reasons };
  } catch (err) {
    return ungraded(`could not be graded this run: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
  }
}

/** Run `work` over `items`, `concurrency` at a time, in order of completion. */
async function pool<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]!);
      }
    }),
  );
  return results;
}

export async function crawl(options: CrawlOptions & { limit?: number; only?: string[]; concurrency?: number; onProgress?: (done: number, total: number, entry: McpIndexEntry) => void }): Promise<McpIndex> {
  const servers = options.only
    ? (await Promise.all(options.only.map((name) => listServers(options.fetch, { search: name })))).flat().filter((s) => options.only!.includes(s.name))
    : await listServers(options.fetch, options.limit !== undefined ? { limit: options.limit } : {});
  let done = 0;
  const entries = await pool(servers, options.concurrency ?? 6, async (server) => {
    const entry = await gradeServer(server, options);
    options.onProgress?.(++done, servers.length, entry);
    return entry;
  });
  return { format: 1, rubricVersion: RUBRIC_VERSION, generatedAt: (options.now?.() ?? new Date()).toISOString(), servers: entries };
}
