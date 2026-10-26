import semver from "semver";

/**
 * Provenance of the artifact an MCP server command would run: which package
 * and version `npx`/`uvx` would fetch, or which image `docker run` would
 * start, and whether a Sigstore-signed build attestation ties it to a source
 * repository. The signature check itself is passed in (`verifyBundle`), so
 * this module needs no crypto dependencies.
 */

export type LaunchTarget =
  | { ecosystem: "npm"; name: string; spec: string; /** Index in args of the package argument */ argIndex: number }
  | { ecosystem: "pypi"; name: string; spec: string; argIndex: number }
  | { ecosystem: "oci"; reference: string; digest?: string; argIndex: number };

/** `@scope/name@1.2.3` → name and spec ("" when none). */
export function splitNpmSpec(arg: string): { name: string; spec: string } {
  const at = arg.indexOf("@", arg.startsWith("@") ? 1 : 0);
  return at === -1 ? { name: arg, spec: "" } : { name: arg.slice(0, at), spec: arg.slice(at + 1) };
}

const NPM_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Docker `run` options that take a separate value (`-e X`), so the image is not mistaken for one. */
const DOCKER_VALUE_FLAGS = new Set([
  "-e", "--env", "--env-file", "-v", "--volume", "--mount", "--name", "-p", "--publish", "--network", "--net", "-w", "--workdir",
  "-u", "--user", "--entrypoint", "-l", "--label", "--platform", "--pull", "-m", "--memory", "--cpus", "--add-host", "--cap-add",
  "--cap-drop", "--security-opt", "--tmpfs", "--device", "-h", "--hostname", "--ulimit", "--restart", "--runtime", "--gpus",
  "--ipc", "--pid", "--userns", "--log-driver", "--log-opt", "--dns", "--expose", "--group-add", "--shm-size", "--stop-signal",
]);

const base = (command: string) => command.split(/[\\/]/).pop()!.replace(/\.(cmd|exe)$/i, "");

/**
 * The artifact `command args` would fetch and run, for npx / pnpm dlx / bunx,
 * uvx, and docker/podman run. Undefined for anything else (a local binary,
 * `node server.js`): there is no registry artifact to check.
 */
export function parseLaunch(command: string, args: readonly string[]): LaunchTarget | undefined {
  const cmd = base(command);
  let i = 0;
  const npmLike = cmd === "npx" || cmd === "bunx" || (cmd === "pnpm" && args[0] === "dlx") || (cmd === "npm" && args[0] === "exec");
  if (npmLike) {
    if (cmd === "pnpm" || cmd === "npm") i = 1;
    for (; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--") continue;
      if (arg === "-p" || arg === "--package") {
        const value = args[i + 1];
        return value && NPM_NAME.test(splitNpmSpec(value).name) ? { ecosystem: "npm", ...splitNpmSpec(value), argIndex: i + 1 } : undefined;
      }
      if (arg.startsWith("--package=")) {
        const value = arg.slice("--package=".length);
        return NPM_NAME.test(splitNpmSpec(value).name) ? { ecosystem: "npm", ...splitNpmSpec(value), argIndex: i } : undefined;
      }
      if (arg.startsWith("-")) continue;
      const spec = splitNpmSpec(arg);
      return NPM_NAME.test(spec.name) ? { ecosystem: "npm", ...spec, argIndex: i } : undefined;
    }
    return undefined;
  }
  if (cmd === "uvx" || (cmd === "uv" && args[0] === "tool" && args[1] === "run")) {
    if (cmd === "uv") i = 2;
    for (; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--from") {
        const value = args[i + 1] ?? "";
        const [name, spec = ""] = value.split("==");
        return PYPI_NAME.test(name!) ? { ecosystem: "pypi", name: name!, spec, argIndex: i + 1 } : undefined;
      }
      if (arg.startsWith("-")) continue;
      const [name, spec = ""] = arg.split("==");
      return PYPI_NAME.test(name!) ? { ecosystem: "pypi", name: name!, spec, argIndex: i } : undefined;
    }
    return undefined;
  }
  if ((cmd === "docker" || cmd === "podman") && args[0] === "run") {
    for (i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (DOCKER_VALUE_FLAGS.has(arg)) {
        i++;
        continue;
      }
      if (arg.startsWith("-")) continue;
      const digest = /@(sha256:[a-f0-9]{64})$/.exec(arg)?.[1];
      return { ecosystem: "oci", reference: arg, ...(digest ? { digest } : {}), argIndex: i };
    }
  }
  return undefined;
}

export type ProvenanceStatus =
  /** A signed build attestation ties the exact artifact to its source repository. */
  | "verified"
  /** The registry has no build attestation for this version. */
  | "unsigned"
  /** An attestation exists but does not hold: bad signature, other artifact, other repository, or a changed artifact. */
  | "invalid"
  /** The check could not run (registry unreachable, unknown version). */
  | "error"
  /** No check for this kind of artifact yet (PyPI, OCI signatures). */
  | "unsupported";

export interface ProvenanceResult {
  status: ProvenanceStatus;
  /** `npm:@scope/name@1.2.3`, `pypi:name`, `oci:image@sha256:…` */
  artifact: string;
  reason: string;
  name?: string;
  /** The exact version that was checked, which the command should be pinned to. */
  version?: string;
  /** Subresource-integrity hash of the package (npm `dist.integrity`). */
  integrity?: string;
  /** The repository the attestation says the artifact was built from. */
  sourceRepository?: string;
  sourceCommit?: string;
}

/** What `verifyBundle` reports about a Sigstore bundle whose signature holds. */
export interface BundleSigner {
  /** Certificate SAN: for GitHub Actions, `https://github.com/<owner>/<repo>/<workflow>@<ref>`. */
  subjectAlternativeName?: string;
  /** OIDC issuer of the signing certificate. */
  issuer?: string;
}

/** Checks a Sigstore bundle's signature, certificate chain and transparency log entry; throws when they do not hold. */
export type BundleVerifier = (bundle: unknown) => Promise<BundleSigner>;

export interface NpmProvenanceOptions {
  verifyBundle: BundleVerifier;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  registry?: string;
}

/** `git+https://github.com/Owner/Repo.git`, `github:owner/repo`, `git@github.com:o/r` → `https://github.com/owner/repo`. */
export function normalizeRepositoryUrl(repository: unknown): string | undefined {
  const raw = typeof repository === "string" ? repository : typeof repository === "object" && repository && "url" in repository ? String((repository as { url: unknown }).url) : undefined;
  if (!raw) return undefined;
  let url = raw.trim();
  const shorthand = /^(github|gitlab):([\w.-]+\/[\w.-]+)$/.exec(url) ?? (/^([\w.-]+\/[\w.-]+)$/.test(url) ? [url, "github", url] : null);
  if (shorthand) url = `https://${shorthand[1]}.com/${shorthand[2]}`;
  url = url.replace(/^git\+/, "").replace(/^git@([^:]+):/, "https://$1/").replace(/^(ssh|git):\/\/(git@)?/, "https://").replace(/\.git$/, "").replace(/\/$/, "");
  return url.toLowerCase();
}

function sha512Hex(integrity: string): string | undefined {
  const sri = integrity.split(/\s+/).find((part) => part.startsWith("sha512-"));
  return sri ? Buffer.from(sri.slice("sha512-".length), "base64").toString("hex") : undefined;
}

interface InTotoStatement {
  subject?: { name?: string; digest?: { sha512?: string } }[];
  predicateType?: string;
  predicate?: {
    buildDefinition?: {
      externalParameters?: { workflow?: { repository?: string } };
      resolvedDependencies?: { uri?: string; digest?: { gitCommit?: string } }[];
    };
  };
}

/** The version `spec` selects, as npm would: exact, dist-tag (default `latest`) or the highest version in a range. */
export function resolveNpmVersion(packument: { "dist-tags"?: Record<string, string>; versions?: Record<string, unknown> }, spec: string): string | undefined {
  const tags = packument["dist-tags"] ?? {};
  const versions = Object.keys(packument.versions ?? {});
  if (!spec) return tags["latest"];
  if (semver.valid(spec)) return versions.includes(spec) ? spec : undefined;
  if (tags[spec]) return tags[spec];
  const latest = tags["latest"];
  // npm prefers `latest` when it satisfies the range
  if (latest && semver.satisfies(latest, spec)) return latest;
  return semver.maxSatisfying(versions, spec) ?? undefined;
}

async function getJson(fetchImpl: NonNullable<NpmProvenanceOptions["fetch"]>, url: string, accept = "application/json"): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { accept } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

/**
 * Resolve `name@spec` on the npm registry and check its SLSA provenance:
 * the bundle's signature (via `verifyBundle`), that the signed statement names
 * this exact package and tarball hash, that the signing identity is a workflow
 * of the repository the statement names, and that the package's `repository`
 * field points at that same repository.
 */
export async function checkNpmProvenance(name: string, spec: string, options: NpmProvenanceOptions): Promise<ProvenanceResult> {
  const fetchImpl = options.fetch ?? fetch;
  const registry = (options.registry ?? "https://registry.npmjs.org").replace(/\/$/, "");
  if (!NPM_NAME.test(name)) return { status: "error", artifact: `npm:${name}`, name, reason: `not an npm package name: ${name}` };
  // @scope/name → @scope%2fname, the registry's form; anything else is encoded as well
  const encoded = encodeURIComponent(name).replace(/^%40/, "@").replace(/%2F/g, "%2f");
  let version: string | undefined;
  let manifest: { dist?: { integrity?: string; attestations?: { url?: string } }; repository?: unknown };
  try {
    // The abbreviated document lists versions and tags; the version document has repository and dist
    const packument = (await getJson(fetchImpl, `${registry}/${encoded}`, "application/vnd.npm.install-v1+json")) as Parameters<typeof resolveNpmVersion>[0];
    version = resolveNpmVersion(packument, spec);
    if (!version) return { status: "error", artifact: `npm:${name}@${spec}`, name, reason: `no version of ${name} matches "${spec || "latest"}"` };
    manifest = (await getJson(fetchImpl, `${registry}/${encoded}/${version}`)) as typeof manifest;
  } catch (err) {
    return { status: "error", artifact: `npm:${name}@${spec || "latest"}`, name, reason: `registry lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const artifact = `npm:${name}@${version}`;
  const integrity = manifest.dist?.integrity;
  const base = { artifact, name, version, ...(integrity ? { integrity } : {}) };
  const attestationsUrl = manifest.dist?.attestations?.url;
  if (!attestationsUrl) return { ...base, status: "unsigned", reason: `${name}@${version} was published without a provenance attestation` };

  let bundle: unknown;
  try {
    const list = (await getJson(fetchImpl, attestationsUrl)) as { attestations?: { predicateType?: string; bundle?: unknown }[] };
    bundle = list.attestations?.find((a) => a.predicateType?.startsWith("https://slsa.dev/provenance/"))?.bundle;
  } catch (err) {
    return { ...base, status: "error", reason: `attestation download failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!bundle) return { ...base, status: "unsigned", reason: `${name}@${version} has attestations, but no SLSA build provenance` };

  let signer: BundleSigner;
  try {
    signer = await options.verifyBundle(bundle);
  } catch (err) {
    return { ...base, status: "invalid", reason: `provenance signature does not verify: ${err instanceof Error ? err.message : String(err)}` };
  }
  // The signature covers the DSSE payload: from here on, the statement is the signer's
  const payload = (bundle as { dsseEnvelope?: { payload?: string } }).dsseEnvelope?.payload;
  let statement: InTotoStatement;
  try {
    statement = JSON.parse(Buffer.from(payload ?? "", "base64").toString("utf8")) as InTotoStatement;
  } catch {
    return { ...base, status: "invalid", reason: "provenance statement is not JSON" };
  }
  const expectedHash = integrity ? sha512Hex(integrity) : undefined;
  const subject = statement.subject?.find((s) => {
    try {
      return decodeURIComponent(s.name ?? "") === `pkg:npm/${name}@${version}`;
    } catch {
      return false;
    }
  });
  if (!subject) return { ...base, status: "invalid", reason: `provenance is for another package (${statement.subject?.map((s) => s.name).join(", ") || "no subject"})` };
  if (!expectedHash || subject.digest?.sha512 !== expectedHash) return { ...base, status: "invalid", reason: "provenance is for another tarball: its sha512 differs from the registry's integrity" };

  const build = statement.predicate?.buildDefinition;
  const sourceRepository = normalizeRepositoryUrl(build?.externalParameters?.workflow?.repository);
  const sourceCommit = build?.resolvedDependencies?.find((d) => d.digest?.gitCommit)?.digest?.gitCommit;
  const withSource = { ...base, ...(sourceRepository ? { sourceRepository } : {}), ...(sourceCommit ? { sourceCommit } : {}) };
  if (!sourceRepository) return { ...withSource, status: "invalid", reason: "provenance names no source repository" };
  // The certificate was issued to a workflow of the repository the statement claims
  const san = signer.subjectAlternativeName?.toLowerCase() ?? "";
  if (!san.startsWith(`${sourceRepository}/`)) {
    return { ...withSource, status: "invalid", reason: `signed by ${signer.subjectAlternativeName ?? "an unknown identity"}, not by a workflow of ${sourceRepository}` };
  }
  const declared = normalizeRepositoryUrl(manifest.repository);
  if (declared && declared !== sourceRepository) {
    return { ...withSource, status: "invalid", reason: `package.json names ${declared}, but it was built from ${sourceRepository}` };
  }
  return { ...withSource, status: "verified", reason: `built from ${sourceRepository}${sourceCommit ? `@${sourceCommit.slice(0, 12)}` : ""} (signed by ${signer.subjectAlternativeName})` };
}
