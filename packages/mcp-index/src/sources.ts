import { normalizeRepositoryUrl, resolveNpmVersion } from "@guardbee/guard-core";
import { readTarGz, readZip, type ArchiveFile } from "./archive.js";
import { getBytes, getJson, type Fetch } from "./http.js";

/** What the scorer needs to know about one published package version. */
export interface PackageFacts {
  ecosystem: "npm" | "pypi";
  name: string;
  version: string;
  /** First publication of the package (any version). */
  createdAt?: string;
  /** Publication of this version. */
  publishedAt?: string;
  /** Number of published versions. */
  releases: number;
  license?: string;
  repository?: string;
  deprecated?: string;
  /** npm lifecycle scripts that run on install. */
  installScripts: string[];
  /** Source files (scanner input), bounded. */
  files: ArchiveFile[];
}

const MAX_ARCHIVE = 50 * 1024 * 1024;
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go)$/i;
/** Tests, examples, vendored code and type stubs: not what runs when the server does. */
const NOT_RUNTIME = /(?:^|\/)(?:node_modules|__tests__|tests?|spec|examples?|fixtures?|docs?|benchmarks?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$|(?:^|\/)test_[^/]*\.py$/i;

export const keepSource = (path: string) => SOURCE.test(path) && !NOT_RUNTIME.test(path);

interface Packument {
  name: string;
  "dist-tags"?: Record<string, string>;
  time?: Record<string, string>;
  versions?: Record<
    string,
    {
      license?: string | { type?: string };
      repository?: unknown;
      deprecated?: string;
      scripts?: Record<string, string>;
      dist?: { tarball?: string };
    }
  >;
}

export async function npmFacts(fetchFn: Fetch, name: string, spec: string | undefined, registry = "https://registry.npmjs.org"): Promise<PackageFacts | undefined> {
  const packument = await getJson<Packument>(fetchFn, `${registry}/${name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)}`);
  if (!packument) return undefined;
  const version = resolveNpmVersion(packument, spec ?? "latest") ?? packument["dist-tags"]?.["latest"];
  const manifest = version ? packument.versions?.[version] : undefined;
  if (!version || !manifest) return undefined;
  const tarball = manifest.dist?.tarball;
  const files = tarball ? readTarGz(await getBytes(fetchFn, tarball, MAX_ARCHIVE), { keep: (p) => keepSource(p.replace(/^package\//, "")) }) : [];
  const license = typeof manifest.license === "string" ? manifest.license : manifest.license?.type;
  const repository = normalizeRepositoryUrl(manifest.repository);
  return {
    ecosystem: "npm",
    name,
    version,
    ...(packument.time?.["created"] ? { createdAt: packument.time["created"] } : {}),
    ...(packument.time?.[version] ? { publishedAt: packument.time[version] } : {}),
    releases: Object.keys(packument.versions ?? {}).length,
    ...(license ? { license } : {}),
    ...(repository ? { repository } : {}),
    ...(manifest.deprecated ? { deprecated: manifest.deprecated } : {}),
    installScripts: ["preinstall", "install", "postinstall"].filter((s) => manifest.scripts?.[s]),
    files: files.map((f) => ({ path: f.path.replace(/^package\//, ""), data: f.data })),
  };
}

interface PypiProject {
  info: { name: string; version: string; license?: string | null; license_expression?: string | null; classifiers?: string[]; project_urls?: Record<string, string> | null; home_page?: string | null; yanked?: boolean; yanked_reason?: string | null };
  releases?: Record<string, { upload_time_iso_8601?: string }[]>;
  urls: { packagetype: string; filename: string; url: string; upload_time_iso_8601?: string; size?: number }[];
}

function pypiRepository(info: PypiProject["info"]): string | undefined {
  const urls = [...Object.values(info.project_urls ?? {}), info.home_page ?? ""];
  for (const url of urls) {
    const repo = normalizeRepositoryUrl(url);
    if (repo && /^https:\/\/(?:github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/[^/]+\/[^/]+$/.test(repo)) return repo;
  }
  return undefined;
}

export async function pypiFacts(fetchFn: Fetch, name: string, version: string | undefined, index = "https://pypi.org"): Promise<PackageFacts | undefined> {
  const project = await getJson<PypiProject>(fetchFn, `${index}/pypi/${encodeURIComponent(name)}/json`);
  if (!project) return undefined;
  const wanted = version && project.releases?.[version] ? version : project.info.version;
  const release = wanted === project.info.version ? project : await getJson<PypiProject>(fetchFn, `${index}/pypi/${encodeURIComponent(name)}/${encodeURIComponent(wanted)}/json`);
  if (!release) return undefined;
  // Prefer the wheel (what pip / uv install), else the sdist
  const wheel = release.urls.find((u) => u.packagetype === "bdist_wheel" && /-(?:py3|py2\.py3)-none-any\.whl$/.test(u.filename)) ?? release.urls.find((u) => u.packagetype === "bdist_wheel");
  const sdist = release.urls.find((u) => u.packagetype === "sdist" && /\.tar\.gz$/.test(u.filename));
  let files: ArchiveFile[] = [];
  if (wheel) files = readZip(await getBytes(fetchFn, wheel.url, MAX_ARCHIVE), { keep: keepSource });
  else if (sdist) files = readTarGz(await getBytes(fetchFn, sdist.url, MAX_ARCHIVE), { keep: (p) => keepSource(p.split("/").slice(1).join("/")) });
  const uploads = Object.values(project.releases ?? {})
    .flat()
    .map((u) => u.upload_time_iso_8601)
    .filter((t): t is string => !!t)
    .sort();
  const license = project.info.license_expression || (project.info.license && project.info.license.length < 100 ? project.info.license : undefined) || project.info.classifiers?.find((c) => c.startsWith("License ::"))?.split(" :: ").pop();
  const repository = pypiRepository(release.info);
  const publishedAt = release.urls.map((u) => u.upload_time_iso_8601).filter((t): t is string => !!t).sort()[0];
  return {
    ecosystem: "pypi",
    name: project.info.name,
    version: wanted,
    ...(uploads[0] ? { createdAt: uploads[0] } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    releases: Object.keys(project.releases ?? {}).length,
    ...(license ? { license } : {}),
    ...(repository ? { repository } : {}),
    ...(release.info.yanked ? { deprecated: `yanked${release.info.yanked_reason ? `: ${release.info.yanked_reason}` : ""}` } : {}),
    installScripts: [],
    files,
  };
}
