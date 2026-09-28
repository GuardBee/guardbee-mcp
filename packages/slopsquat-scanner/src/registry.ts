export type Ecosystem = "npm" | "PyPI";

export interface RegistryCheck {
  name: string;
  ecosystem: Ecosystem;
  exists: boolean;
  /** Days since the package's earliest known release, if it exists. */
  ageDays?: number;
  error?: string;
}

const NPM_REGISTRY = "https://registry.npmjs.org";
const PYPI_REGISTRY = "https://pypi.org/pypi";
const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Scoped packages (@scope/name) keep the leading @ literal but must have the internal / percent-encoded, or the registry sees two path segments instead of one package name. */
function npmRegistryUrl(name: string): string {
  if (name.startsWith("@")) return `${NPM_REGISTRY}/${name.replace("/", "%2F")}`;
  return `${NPM_REGISTRY}/${encodeURIComponent(name)}`;
}

export async function checkNpmPackage(name: string): Promise<RegistryCheck> {
  const url = npmRegistryUrl(name);
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 404) return { name, ecosystem: "npm", exists: false };
    if (!res.ok) return { name, ecosystem: "npm", exists: true, error: `registry returned ${res.status}` };

    const data = (await res.json()) as { time?: { created?: string } };
    const created = data.time?.created;
    const ageDays = created ? Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000) : undefined;
    return { name, ecosystem: "npm", exists: true, ageDays };
  } catch (err) {
    return { name, ecosystem: "npm", exists: true, error: (err as Error).message };
  }
}

export async function checkPyPIPackage(name: string): Promise<RegistryCheck> {
  const url = `${PYPI_REGISTRY}/${encodeURIComponent(name)}/json`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 404) return { name, ecosystem: "PyPI", exists: false };
    if (!res.ok) return { name, ecosystem: "PyPI", exists: true, error: `registry returned ${res.status}` };

    const data = (await res.json()) as { releases?: Record<string, Array<{ upload_time_iso_8601?: string }>> };
    let earliest: number | undefined;
    for (const files of Object.values(data.releases ?? {})) {
      for (const f of files) {
        if (!f.upload_time_iso_8601) continue;
        const t = new Date(f.upload_time_iso_8601).getTime();
        if (!Number.isNaN(t) && (earliest === undefined || t < earliest)) earliest = t;
      }
    }
    const ageDays = earliest !== undefined ? Math.floor((Date.now() - earliest) / 86_400_000) : undefined;
    return { name, ecosystem: "PyPI", exists: true, ageDays };
  } catch (err) {
    return { name, ecosystem: "PyPI", exists: true, error: (err as Error).message };
  }
}

/** Bounded-concurrency map — the registries have no batch-existence endpoint, so each package is its own request; this caps how many are in flight at once instead of firing them all simultaneously. */
export async function checkPackagesConcurrently<T>(
  items: T[],
  checker: (item: T) => Promise<RegistryCheck>,
  concurrency = 8
): Promise<RegistryCheck[]> {
  const results: RegistryCheck[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await checker(items[i] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
