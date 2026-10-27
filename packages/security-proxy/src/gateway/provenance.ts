import fs from "fs";
import os from "os";
import path from "path";
import { bundleFromJSON } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { getTrustedRoot } from "@sigstore/tuf";
import { Verifier, toSignedEntity, toTrustMaterial } from "@sigstore/verify";
import {
  checkNpmProvenance,
  checkOciProvenance,
  checkPypiProvenance,
  parseImageReference,
  parseLaunch,
  type BundleVerifier,
  type LaunchTarget,
  type ProvenanceResult,
} from "@guardbee/guard-core";
import type { McpServerConfig } from "../types.js";

/**
 * Provenance check before a stdio upstream starts: the npm package `npx`
 * would run must carry a Sigstore-signed SLSA build attestation that ties
 * that exact tarball to its source repository. The command is then pinned to
 * the version that was checked, so a release published in between is not
 * what runs.
 */
export type ProvenanceMode = "off" | "warn" | "require";

export interface ProvenanceConfig {
  /** Default for every stdio upstream; `upstreams.<name>.provenance` overrides it. */
  mode: ProvenanceMode;
  /** Use only the cache and the Sigstore trust root already on disk: no registry or TUF requests. */
  offline: boolean;
  /** Results by package version; default ~/.guardbee/provenance.json. */
  cacheFile?: string;
  /** npm registry; default npm_config_registry or https://registry.npmjs.org. */
  registry?: string;
  /** PyPI-compatible index (with the PEP 740 integrity API); default https://pypi.org. */
  pypiIndex?: string;
  /** Who must have signed an image: image glob → certificate SAN prefix. ghcr.io/<owner>/… needs no entry. */
  signers?: Record<string, string>;
}

export function defaultProvenanceCache(): string {
  return process.env["GUARDBEE_PROVENANCE_CACHE"] || path.join(os.homedir(), ".guardbee", "provenance.json");
}

interface CacheEntry {
  status: ProvenanceResult["status"];
  integrity?: string;
  sourceRepository?: string;
  sourceCommit?: string;
  reason: string;
  checkedAt: string;
}

/**
 * Results by artifact (`npm:name@version`). A published npm version never
 * changes, so a verified entry stays valid; an integrity that differs from
 * the one recorded means the registry now serves another tarball under the
 * same version, which is treated as tampering.
 */
export class ProvenanceCache {
  private entries: Record<string, CacheEntry>;

  constructor(readonly file: string = defaultProvenanceCache()) {
    this.entries = {};
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: number; entries?: Record<string, CacheEntry> };
      if (parsed.version !== 1 || typeof parsed.entries !== "object") throw new Error(`${file} is not a GuardBee provenance cache (version 1)`);
      this.entries = parsed.entries;
    }
  }

  get(artifact: string): CacheEntry | undefined {
    return this.entries[artifact];
  }

  /** Remember a definite answer; registry or network errors are not cached. */
  record(result: ProvenanceResult): void {
    if (result.status === "error" || result.status === "unsupported") return;
    this.entries[result.artifact] = {
      status: result.status,
      ...(result.integrity ? { integrity: result.integrity } : {}),
      ...(result.sourceRepository ? { sourceRepository: result.sourceRepository } : {}),
      ...(result.sourceCommit ? { sourceCommit: result.sourceCommit } : {}),
      reason: result.reason,
      checkedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ version: 1, entries: this.entries }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
}

/**
 * Sigstore verification with the public-good trust root, fetched through TUF
 * (cached under ~/.guardbee/sigstore) the first time a bundle needs it. Every
 * bundle needs a transparency-log entry and an SCT for its certificate.
 */
export function sigstoreVerifier(options: { offline?: boolean; cachePath?: string; trustedRoot?: unknown } = {}): BundleVerifier {
  let verifier: Promise<Verifier> | undefined;
  const load = async () => {
    const root = options.trustedRoot
      ? TrustedRoot.fromJSON(options.trustedRoot)
      : await getTrustedRoot({ cachePath: options.cachePath ?? path.join(os.homedir(), ".guardbee", "sigstore"), forceCache: options.offline ?? false });
    return new Verifier(toTrustMaterial(root), { tlogThreshold: 1, ctlogThreshold: 1 });
  };
  return async (json, artifact) => {
    verifier ??= load();
    const signer = (await verifier).verify(toSignedEntity(bundleFromJSON(json), artifact ? Buffer.from(artifact) : undefined));
    return {
      ...(signer.identity?.subjectAlternativeName ? { subjectAlternativeName: signer.identity.subjectAlternativeName } : {}),
      ...(signer.identity?.extensions?.issuer ? { issuer: signer.identity.extensions.issuer } : {}),
    };
  };
}

export interface UpstreamProvenance {
  /** What the check found; absent when the command runs no registry artifact (a local binary, `node server.js`). */
  result?: ProvenanceResult;
  /** `allow`: start it; `warn`: start it and log; `block`: do not start it. */
  action: "allow" | "warn" | "block";
  /** The server config to start: the package argument pinned to the checked version. */
  server: McpServerConfig;
}

export interface CheckOptions {
  verifyBundle: BundleVerifier;
  cache: ProvenanceCache;
  offline: boolean;
  /** npm registry. */
  registry?: string;
  /** PyPI-compatible index with the integrity API; default https://pypi.org. */
  pypiIndex?: string;
  /** Expected image signers, by image glob → certificate SAN prefix. */
  signers?: Record<string, string>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

function npmRegistry(configured?: string): string {
  return configured ?? process.env["npm_config_registry"] ?? "https://registry.npmjs.org";
}

/** The cache key an exact artifact would have, so it can be answered offline; undefined when the spec floats. */
function exactArtifact(target: LaunchTarget): string | undefined {
  if (target.ecosystem === "npm") return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(target.spec) ? `npm:${target.name}@${target.spec}` : undefined;
  if (target.ecosystem === "pypi") return target.spec ? `pypi:${target.name}==${target.spec}` : undefined;
  const image = parseImageReference(target.reference);
  return image?.digest ? `oci:${image.registry}/${image.repository}@${image.digest}` : undefined;
}

async function freshResult(target: LaunchTarget, options: CheckOptions): Promise<ProvenanceResult> {
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  if (target.ecosystem === "npm") return checkNpmProvenance(target.name, target.spec, { verifyBundle: options.verifyBundle, registry: npmRegistry(options.registry), ...fetchOption });
  if (target.ecosystem === "pypi") return checkPypiProvenance(target.name, target.spec, { verifyBundle: options.verifyBundle, ...(options.pypiIndex ? { index: options.pypiIndex } : {}), ...fetchOption });
  return checkOciProvenance(target.reference, { verifyBundle: options.verifyBundle, ...(options.signers ? { signers: options.signers } : {}), ...fetchOption });
}

async function targetResult(target: LaunchTarget, options: CheckOptions): Promise<ProvenanceResult> {
  if (options.offline) {
    // Offline only an exact version or digest can be answered, from the cache
    const key = exactArtifact(target);
    const cached = key ? options.cache.get(key) : undefined;
    const what = target.ecosystem === "oci" ? target.reference : `${target.name} ${target.spec || "(latest)"}`;
    if (!key || !cached) return { status: "error", artifact: key ?? `${target.ecosystem}:${what}`, reason: `offline and ${what} is not in the provenance cache (pin an exact version or digest and check it once online)` };
    const [, version] = /(?:@|==)([^@=]+)$/.exec(key) ?? [];
    return { ...cached, artifact: key, ...(version ? { version } : {}), reason: `${cached.reason} (cached ${cached.checkedAt})` };
  }
  const result = await freshResult(target, options);
  const known = options.cache.get(result.artifact);
  if (known?.integrity && result.integrity && known.integrity !== result.integrity) {
    return { ...result, status: "invalid", reason: `the registry now serves other files for ${result.artifact} (changed since ${known.checkedAt})` };
  }
  options.cache.record(result);
  return result;
}

/** The launch argument pinned to what was checked: npm `name@version`, PyPI `name==version`, an image `@digest`. */
function pinnedArgument(target: LaunchTarget, current: string, version: string): string {
  if (target.ecosystem === "npm") return current.startsWith("--package=") ? `--package=${target.name}@${version}` : `${target.name}@${version}`;
  if (target.ecosystem === "pypi") return `${target.name}==${version}`;
  return `${target.reference.replace(/@sha256:[a-f0-9]{64}$/, "")}@${version}`;
}

export async function checkUpstreamProvenance(server: McpServerConfig, mode: ProvenanceMode, options: CheckOptions): Promise<UpstreamProvenance> {
  if (mode === "off") return { action: "allow", server };
  const args = server.args ?? [];
  const target = parseLaunch(server.command, args);
  if (!target) return { action: "allow", server };

  const result = await targetResult(target, options);
  const action = result.status === "verified" ? "allow" : mode === "require" ? "block" : "warn";
  // Run exactly what was checked
  let pinned = server;
  if (result.version && action !== "block") {
    const pinnedArgs = [...args];
    const argument = pinnedArgument(target, pinnedArgs[target.argIndex]!, result.version);
    if (argument !== pinnedArgs[target.argIndex]) {
      pinnedArgs[target.argIndex] = argument;
      pinned = { ...server, args: pinnedArgs };
    }
  }
  return { result, action, server: pinned };
}

const SARIF_RULES: Record<Exclude<ProvenanceResult["status"], "verified">, { name: string; level: "error" | "warning"; text: string }> = {
  invalid: { name: "Provenance does not hold", level: "error", text: "The artifact has a build attestation or signature that does not verify, is for another artifact, or was signed by an unexpected identity." },
  unsigned: { name: "No build provenance", level: "warning", text: "The artifact was published without a build attestation (npm provenance, PEP 740) or cosign signature, so nothing ties it to a source repository." },
  unsupported: { name: "Signer not known", level: "warning", text: "The artifact is signed, but no expected signer is configured for it (provenance.signers)." },
  error: { name: "Provenance check failed", level: "warning", text: "The registry could not be reached or the version was not found." },
};

/** SARIF 2.1.0 for `guardbee-proxy provenance --format sarif`: one result per upstream that is not verified. */
export function provenanceSarif(entries: { upstream: string; result: ProvenanceResult }[], version: string, configUri: string): unknown {
  const findings = entries.filter((e): e is { upstream: string; result: ProvenanceResult & { status: keyof typeof SARIF_RULES } } => e.result.status !== "verified");
  const ruleIds = [...new Set(findings.map((f) => f.result.status))];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "guardbee-proxy provenance",
            version,
            informationUri: "https://github.com/GuardBee/guardbee-mcp/tree/main/packages/security-proxy#readme",
            rules: ruleIds.map((status) => ({
              id: `provenance/${status}`,
              name: SARIF_RULES[status].name,
              shortDescription: { text: SARIF_RULES[status].name },
              fullDescription: { text: SARIF_RULES[status].text },
              defaultConfiguration: { level: SARIF_RULES[status].level },
              properties: { tags: ["security", "supply-chain", "MCP04:2025"] },
            })),
          },
        },
        results: findings.map(({ upstream, result }) => ({
          ruleId: `provenance/${result.status}`,
          level: SARIF_RULES[result.status].level,
          message: { text: `upstreams.${upstream}: ${result.artifact}: ${result.reason}` },
          locations: [{ physicalLocation: { artifactLocation: { uri: configUri } } }],
          partialFingerprints: { artifact: result.artifact },
        })),
      },
    ],
  };
}
