import fs from "fs";
import os from "os";
import path from "path";
import { bundleFromJSON } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { getTrustedRoot } from "@sigstore/tuf";
import { Verifier, toSignedEntity, toTrustMaterial } from "@sigstore/verify";
import { checkNpmProvenance, parseLaunch, type BundleVerifier, type ProvenanceResult } from "@guardbee/guard-core";
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
  return async (json) => {
    verifier ??= load();
    const signer = (await verifier).verify(toSignedEntity(bundleFromJSON(json)));
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
  registry?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

function npmRegistry(configured?: string): string {
  return configured ?? process.env["npm_config_registry"] ?? "https://registry.npmjs.org";
}

async function npmResult(name: string, spec: string, options: CheckOptions): Promise<ProvenanceResult> {
  if (options.offline) {
    // Offline only an exact version can be answered, from the cache
    const cached = options.cache.get(`npm:${name}@${spec}`);
    if (!cached) return { status: "error", artifact: `npm:${name}@${spec || "latest"}`, name, reason: `offline and ${name}@${spec || "latest"} is not in the provenance cache (pin an exact version and check it once online)` };
    return { ...cached, artifact: `npm:${name}@${spec}`, name, version: spec, reason: `${cached.reason} (cached ${cached.checkedAt})` };
  }
  const result = await checkNpmProvenance(name, spec, { verifyBundle: options.verifyBundle, registry: npmRegistry(options.registry), ...(options.fetch ? { fetch: options.fetch } : {}) });
  const known = options.cache.get(result.artifact);
  if (known?.integrity && result.integrity && known.integrity !== result.integrity) {
    return { ...result, status: "invalid", reason: `the registry now serves another tarball for ${result.artifact} (integrity changed since ${known.checkedAt})` };
  }
  options.cache.record(result);
  return result;
}

export async function checkUpstreamProvenance(server: McpServerConfig, mode: ProvenanceMode, options: CheckOptions): Promise<UpstreamProvenance> {
  if (mode === "off") return { action: "allow", server };
  const args = server.args ?? [];
  const target = parseLaunch(server.command, args);
  if (!target) return { action: "allow", server };

  let result: ProvenanceResult;
  if (target.ecosystem === "npm") {
    result = await npmResult(target.name, target.spec, options);
  } else if (target.ecosystem === "pypi") {
    result = { status: "unsupported", artifact: `pypi:${target.name}${target.spec ? `==${target.spec}` : ""}`, name: target.name, reason: "PyPI attestations (PEP 740) are not checked yet" };
  } else {
    result = {
      status: "unsupported",
      artifact: `oci:${target.reference}`,
      reason: target.digest ? "container image signatures (cosign) are not checked yet" : "the image is not pinned by digest (@sha256:…), so a tag can be moved to another image",
    };
  }
  const action = result.status === "verified" ? "allow" : mode === "require" ? "block" : "warn";
  // Run exactly what was checked: pin npx to the resolved version
  let pinned = server;
  if (target.ecosystem === "npm" && result.version && target.spec !== result.version && action !== "block") {
    const pinnedArgs = [...args];
    const current = pinnedArgs[target.argIndex]!;
    pinnedArgs[target.argIndex] = current.startsWith("--package=") ? `--package=${target.name}@${result.version}` : `${target.name}@${result.version}`;
    pinned = { ...server, args: pinnedArgs };
  }
  return { result, action, server: pinned };
}
