import { X509Certificate, createHash } from "node:crypto";
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

/** Docker `run` options that take a separate value (`-e X`), so the image is not mistaken for one. */
const DOCKER_VALUE_FLAGS = new Set([
  "-e", "--env", "--env-file", "-v", "--volume", "--mount", "--name", "-p", "--publish", "--network", "--net", "-w", "--workdir",
  "-u", "--user", "--entrypoint", "-l", "--label", "--platform", "--pull", "-m", "--memory", "--cpus", "--add-host", "--cap-add",
  "--cap-drop", "--security-opt", "--tmpfs", "--device", "-h", "--hostname", "--ulimit", "--restart", "--runtime", "--gpus",
  "--ipc", "--pid", "--userns", "--log-driver", "--log-opt", "--dns", "--expose", "--group-add", "--shm-size", "--stop-signal",
]);

/** uvx options that take a separate value, so it is not mistaken for the tool. */
const UV_VALUE_FLAGS = new Set(["--with", "-w", "--with-requirements", "--with-editable", "--python", "-p", "--index", "--index-url", "--extra-index-url", "--default-index", "--find-links", "-f", "--constraints", "--overrides"]);

/** `name==1.2.3` or uvx's `name@1.2.3`; anything else (`>=`, extras, a URL) is not resolved and the spec stays empty. */
function pypiTarget(arg: string, argIndex: number): LaunchTarget | undefined {
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:(?:==|@)([A-Za-z0-9.+!_-]+))?$/.exec(arg);
  return match ? { ecosystem: "pypi", name: match[1]!, spec: match[2] ?? "", argIndex } : undefined;
}

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
      if (arg === "--from") return pypiTarget(args[i + 1] ?? "", i + 1);
      if (UV_VALUE_FLAGS.has(arg)) {
        i++;
        continue;
      }
      if (arg.startsWith("-")) continue;
      return pypiTarget(arg, i);
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

/**
 * Checks a Sigstore bundle's signature, certificate chain and transparency
 * log entry; throws when they do not hold. `artifact` is the signed bytes for
 * a bundle that carries a message signature (cosign) rather than a DSSE envelope.
 */
export type BundleVerifier = (bundle: unknown, artifact?: Uint8Array) => Promise<BundleSigner>;

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

/** A PEP 740 attestation as PyPI's integrity API serves it. */
interface PypiAttestation {
  envelope?: { statement?: string; signature?: string };
  verification_material?: { certificate?: string; transparency_entries?: unknown[] };
}

/** The Trusted Publisher that uploaded the file. */
interface PypiPublisher {
  kind?: string;
  repository?: string;
  workflow?: string;
}

/** PEP 740 attestation → Sigstore bundle (v0.3, DSSE), the form a Sigstore verifier takes. */
export function pypiAttestationToBundle(attestation: unknown): unknown {
  const a = attestation as PypiAttestation;
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: { certificate: { rawBytes: a.verification_material?.certificate }, tlogEntries: a.verification_material?.transparency_entries ?? [] },
    dsseEnvelope: { payload: a.envelope?.statement, payloadType: "application/vnd.in-toto+json", signatures: [{ sig: a.envelope?.signature, keyid: "" }] },
  };
}

/** `GitHub` + `owner/repo` → https://github.com/owner/repo (GitLab likewise). */
function publisherRepository(publisher: PypiPublisher): string | undefined {
  if (!publisher.repository) return undefined;
  const host = publisher.kind === "GitHub" ? "github.com" : publisher.kind === "GitLab" ? "gitlab.com" : undefined;
  return host ? `https://${host}/${publisher.repository}`.toLowerCase() : undefined;
}

export interface PypiProvenanceOptions {
  verifyBundle: BundleVerifier;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Default https://pypi.org. */
  index?: string;
}

/**
 * Resolve `name==spec` on PyPI and check the PEP 740 attestation of every
 * file of that release (uv may pick the wheel or the sdist): each must be
 * signed by its Trusted Publisher's workflow and name that file and its
 * sha256, and all must come from the same repository.
 */
export async function checkPypiProvenance(name: string, spec: string, options: PypiProvenanceOptions): Promise<ProvenanceResult> {
  const fetchImpl = options.fetch ?? fetch;
  const index = (options.index ?? "https://pypi.org").replace(/\/$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || (spec && !/^[A-Za-z0-9.+!_-]+$/.test(spec))) {
    return { status: "error", artifact: `pypi:${name}`, name, reason: `not a PyPI project and version: ${name} ${spec}` };
  }
  let release: { info?: { version?: string }; urls?: { filename?: string; digests?: { sha256?: string } }[] };
  try {
    release = (await getJson(fetchImpl, `${index}/pypi/${name}${spec ? `/${spec}` : ""}/json`)) as typeof release;
  } catch (err) {
    return { status: "error", artifact: `pypi:${name}${spec ? `==${spec}` : ""}`, name, reason: `index lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const version = release.info?.version ?? spec;
  const files = (release.urls ?? []).filter((f): f is { filename: string; digests: { sha256: string } } => !!f.filename && !!f.digests?.sha256);
  const artifact = `pypi:${name}==${version}`;
  // The file hashes stand for the release in the cache: another file under the same version changes it
  const integrity = files.map((f) => `${f.filename}=sha256:${f.digests.sha256}`).sort().join(" ");
  const base = { artifact, name, version, ...(integrity ? { integrity } : {}) };
  if (files.length === 0) return { ...base, status: "error", reason: `${name} ${version} has no files on the index` };

  const repositories = new Set<string>();
  let unsigned = 0;
  for (const file of files) {
    let provenance: { attestation_bundles?: { publisher?: PypiPublisher; attestations?: unknown[] }[] };
    try {
      const response = await fetchImpl(`${index}/integrity/${name}/${version}/${encodeURIComponent(file.filename)}/provenance`, { headers: { accept: "application/vnd.pypi.integrity.v1+json" } });
      if (response.status === 404) {
        unsigned++;
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      provenance = (await response.json()) as typeof provenance;
    } catch (err) {
      return { ...base, status: "error", reason: `attestation download for ${file.filename} failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    const bundles = provenance.attestation_bundles ?? [];
    if (bundles.length === 0) {
      unsigned++;
      continue;
    }
    for (const bundle of bundles) {
      const repository = publisherRepository(bundle.publisher ?? {});
      if (!repository) return { ...base, status: "invalid", reason: `${file.filename}: publisher ${bundle.publisher?.kind ?? "unknown"} is not a source repository this check knows` };
      for (const attestation of bundle.attestations ?? []) {
        let signer: BundleSigner;
        try {
          signer = await options.verifyBundle(pypiAttestationToBundle(attestation));
        } catch (err) {
          return { ...base, status: "invalid", reason: `${file.filename}: attestation signature does not verify: ${err instanceof Error ? err.message : String(err)}` };
        }
        let statement: { subject?: { name?: string; digest?: { sha256?: string } }[] };
        try {
          statement = JSON.parse(Buffer.from((attestation as PypiAttestation).envelope?.statement ?? "", "base64").toString("utf8")) as typeof statement;
        } catch {
          return { ...base, status: "invalid", reason: `${file.filename}: attestation statement is not JSON` };
        }
        const subject = statement.subject?.find((s) => s.name === file.filename);
        if (!subject || subject.digest?.sha256 !== file.digests.sha256) return { ...base, status: "invalid", reason: `${file.filename}: attestation is for another file or hash` };
        if (!signer.subjectAlternativeName?.toLowerCase().startsWith(`${repository}/`)) {
          return { ...base, status: "invalid", reason: `${file.filename}: signed by ${signer.subjectAlternativeName ?? "an unknown identity"}, not by a workflow of its publisher ${repository}` };
        }
        repositories.add(repository);
      }
    }
  }
  if (repositories.size > 1) return { ...base, status: "invalid", reason: `the files of ${name} ${version} were published from different repositories: ${[...repositories].join(", ")}` };
  const [sourceRepository] = repositories;
  if (!sourceRepository) return { ...base, status: "unsigned", reason: `${name} ${version} was published without PEP 740 attestations` };
  if (unsigned > 0) return { ...base, sourceRepository, status: "unsigned", reason: `${unsigned} of ${files.length} files of ${name} ${version} have no attestation` };
  return { ...base, sourceRepository, status: "verified", reason: `${files.length} file(s) published from ${sourceRepository} (PEP 740, Trusted Publisher)` };
}

/** `ghcr.io/owner/repo:tag@sha256:…` → registry host, repository, tag, digest (Docker Hub names get `library/`). */
export function parseImageReference(reference: string): { registry: string; repository: string; tag?: string; digest?: string } | undefined {
  const at = reference.indexOf("@");
  const digest = at === -1 ? undefined : reference.slice(at + 1);
  if (digest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(digest)) return undefined;
  let rest = at === -1 ? reference : reference.slice(0, at);
  const lastSlash = rest.lastIndexOf("/");
  const colon = rest.lastIndexOf(":");
  let tag: string | undefined;
  if (colon > lastSlash) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  const parts = rest.split("/");
  let registry = "docker.io";
  if (parts.length > 1 && /[.:]|^localhost$/.test(parts[0]!)) registry = parts.shift()!;
  if (registry === "docker.io" && parts.length === 1) parts.unshift("library");
  const repository = parts.join("/").toLowerCase();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(repository)) return undefined;
  if (tag !== undefined && !/^[\w][\w.-]{0,127}$/.test(tag)) return undefined;
  return { registry, repository, ...(tag ? { tag } : {}), ...(digest ? { digest } : {}) };
}

const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/** GET from a registry, answering its anonymous Bearer challenge once (public images). */
async function registryGet(fetchImpl: NonNullable<NpmProvenanceOptions["fetch"]>, url: string, accept: string, auth: { token?: string }): Promise<Response> {
  const send = () => fetchImpl(url, { headers: { accept, ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) } });
  let response = await send();
  const challenge = response.status === 401 ? response.headers.get("www-authenticate") : null;
  if (challenge && /^Bearer /i.test(challenge) && !auth.token) {
    const params = Object.fromEntries([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
    if (!params["realm"]?.startsWith("https://")) throw new Error(`registry token realm is not https: ${params["realm"] ?? "none"}`);
    const tokenUrl = new URL(params["realm"]);
    if (params["service"]) tokenUrl.searchParams.set("service", params["service"]);
    if (params["scope"]) tokenUrl.searchParams.set("scope", params["scope"]);
    const tokenResponse = await fetchImpl(tokenUrl.toString(), { headers: { accept: "application/json" } });
    if (!tokenResponse.ok) throw new Error(`registry token: HTTP ${tokenResponse.status}`);
    const body = (await tokenResponse.json()) as { token?: string; access_token?: string };
    auth.token = body.token ?? body.access_token;
    response = await send();
  }
  return response;
}

const sha256Of = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export interface OciProvenanceOptions {
  verifyBundle: BundleVerifier;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Who must have signed an image, by image glob (`docker.io/mcp/*`) → certificate
   * SAN prefix (`https://github.com/docker/`). ghcr.io/<owner>/… defaults to a
   * workflow of github.com/<owner>.
   */
  signers?: Record<string, string>;
}

function expectedSigner(image: string, registry: string, repository: string, signers: Record<string, string>): string | undefined {
  for (const [pattern, san] of Object.entries(signers)) {
    const re = new RegExp(`^${pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^@:]*")}$`);
    if (re.test(image)) return san.toLowerCase();
  }
  if (registry === "ghcr.io") return `https://github.com/${repository.split("/")[0]}/`;
  return undefined;
}

/** A legacy cosign signature layer (`sha256-<digest>.sig`) → Sigstore bundle v0.1 with a message signature. */
function cosignLayerToBundle(annotations: Record<string, string>, payload: Uint8Array): unknown {
  const rekor = JSON.parse(annotations["dev.sigstore.cosign/bundle"] ?? "{}") as {
    SignedEntryTimestamp?: string;
    Payload?: { body?: string; integratedTime?: number; logIndex?: number; logID?: string };
  };
  const body = JSON.parse(Buffer.from(rekor.Payload?.body ?? "", "base64").toString("utf8") || "{}") as { kind?: string; apiVersion?: string };
  const certificate = new X509Certificate(annotations["dev.sigstore.cosign/certificate"] ?? "").raw.toString("base64");
  return {
    mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.1",
    verificationMaterial: {
      x509CertificateChain: { certificates: [{ rawBytes: certificate }] },
      tlogEntries: [
        {
          logIndex: String(rekor.Payload?.logIndex ?? ""),
          logId: { keyId: Buffer.from(rekor.Payload?.logID ?? "", "hex").toString("base64") },
          kindVersion: { kind: body.kind, version: body.apiVersion },
          integratedTime: String(rekor.Payload?.integratedTime ?? ""),
          inclusionPromise: { signedEntryTimestamp: rekor.SignedEntryTimestamp },
          canonicalizedBody: rekor.Payload?.body,
        },
      ],
    },
    messageSignature: {
      messageDigest: { algorithm: "SHA2_256", digest: createHash("sha256").update(payload).digest("base64") },
      signature: annotations["dev.cosignproject.cosign/signature"],
    },
  };
}

/**
 * Resolve an image to its digest and check its cosign keyless signature
 * (`sha256-<digest>.sig`): signed by the expected identity, for that digest.
 * The result's `version` is the digest the command should be pinned to.
 */
export async function checkOciProvenance(reference: string, options: OciProvenanceOptions): Promise<ProvenanceResult> {
  const fetchImpl = options.fetch ?? fetch;
  const parsed = parseImageReference(reference);
  if (!parsed) return { status: "error", artifact: `oci:${reference}`, reason: `not an image reference: ${reference}` };
  const { registry, repository } = parsed;
  const host = registry === "docker.io" ? "registry-1.docker.io" : registry;
  const image = `${registry}/${repository}`;
  const auth: { token?: string } = {};
  let digest = parsed.digest;
  try {
    if (!digest) {
      const response = await registryGet(fetchImpl, `https://${host}/v2/${repository}/manifests/${parsed.tag ?? "latest"}`, MANIFEST_TYPES, auth);
      if (!response.ok) throw new Error(`manifest ${parsed.tag ?? "latest"}: HTTP ${response.status}`);
      // The digest of the bytes received, not the header the registry sent
      digest = sha256Of(new Uint8Array(await response.arrayBuffer()));
    }
  } catch (err) {
    return { status: "error", artifact: `oci:${reference}`, reason: `registry lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const artifact = `oci:${image}@${digest}`;
  const base = { artifact, name: image, version: digest, integrity: digest };
  let manifest: { layers?: { digest?: string; annotations?: Record<string, string> }[] };
  try {
    const response = await registryGet(fetchImpl, `https://${host}/v2/${repository}/manifests/${digest.replace(":", "-")}.sig`, "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json", auth);
    if (response.status === 404) return { ...base, status: "unsigned", reason: `${image} has no cosign signature for ${digest.slice(0, 19)}…` };
    if (!response.ok) throw new Error(`signature manifest: HTTP ${response.status}`);
    manifest = (await response.json()) as typeof manifest;
  } catch (err) {
    return { ...base, status: "error", reason: `signature lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const expected = expectedSigner(image, registry, repository, options.signers ?? {});
  const signers: string[] = [];
  for (const layer of manifest.layers ?? []) {
    const annotations = layer.annotations ?? {};
    if (!annotations["dev.cosignproject.cosign/signature"] || !annotations["dev.sigstore.cosign/certificate"] || !layer.digest) continue;
    let payload: Uint8Array;
    try {
      const response = await registryGet(fetchImpl, `https://${host}/v2/${repository}/blobs/${layer.digest}`, "*/*", auth);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      return { ...base, status: "error", reason: `signature payload download failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (sha256Of(payload) !== layer.digest) return { ...base, status: "invalid", reason: "signature payload does not match its digest" };
    const claim = JSON.parse(Buffer.from(payload).toString("utf8")) as { critical?: { image?: { "docker-manifest-digest"?: string }; identity?: { "docker-reference"?: string } } };
    if (claim.critical?.image?.["docker-manifest-digest"] !== digest) continue; // a signature for another digest
    let signer: BundleSigner;
    try {
      signer = await options.verifyBundle(cosignLayerToBundle(annotations, payload), payload);
    } catch (err) {
      return { ...base, status: "invalid", reason: `cosign signature does not verify: ${err instanceof Error ? err.message : String(err)}` };
    }
    const san = signer.subjectAlternativeName ?? "unknown identity";
    signers.push(san);
    if (expected && san.toLowerCase().startsWith(expected)) {
      const sourceRepository = /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\//.exec(san)?.[1]?.toLowerCase();
      return { ...base, ...(sourceRepository ? { sourceRepository } : {}), status: "verified", reason: `cosign signature by ${san}` };
    }
  }
  if (signers.length === 0) return { ...base, status: "unsigned", reason: `${image} has no cosign signature for ${digest.slice(0, 19)}…` };
  if (!expected) return { ...base, status: "unsupported", reason: `signed by ${signers.join(", ")}, but no expected signer is known for ${image} (provenance.signers)` };
  return { ...base, status: "invalid", reason: `signed by ${signers.join(", ")}, not by ${expected}…` };
}
