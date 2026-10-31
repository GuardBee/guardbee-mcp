import { getJson, type Fetch } from "./http.js";

/** The latest version of every server in the official MCP Registry. */

export const OFFICIAL_REGISTRY = "https://registry.modelcontextprotocol.io";

export interface RegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  registryBaseUrl?: string;
}

export interface RegistryServer {
  name: string;
  version: string;
  title?: string;
  description?: string;
  repository?: { url?: string; source?: string };
  packages?: RegistryPackage[];
  remotes?: { type: string; url: string }[];
}

interface Page {
  servers: { server: RegistryServer; _meta?: Record<string, { status?: string; isLatest?: boolean }> }[];
  metadata?: { nextCursor?: string };
}

export async function listServers(fetchFn: Fetch, options: { registry?: string; limit?: number; search?: string; onPage?: (count: number) => void } = {}): Promise<RegistryServer[]> {
  const base = options.registry ?? OFFICIAL_REGISTRY;
  const out = new Map<string, RegistryServer>();
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "100", version: "latest", ...(options.search ? { search: options.search } : {}), ...(cursor ? { cursor } : {}) });
    const page = await getJson<Page>(fetchFn, `${base}/v0/servers?${query}`);
    if (!page) break;
    for (const item of page.servers) {
      const status = item._meta?.["io.modelcontextprotocol.registry/official"]?.status;
      if (status && status !== "active") continue;
      out.set(item.server.name, item.server);
    }
    options.onPage?.(out.size);
    cursor = page.metadata?.nextCursor;
  } while (cursor && (options.limit === undefined || out.size < options.limit));
  const servers = [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  return options.limit === undefined ? servers : servers.slice(0, options.limit);
}
