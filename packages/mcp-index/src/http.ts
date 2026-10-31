/** Fetch with a timeout and a few retries on 429 / 5xx / network errors (the crawler talks to public registries all day). */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = "GuardBee-MCP-Index/1 (+https://github.com/GuardBee/guardbee-mcp/tree/main/packages/mcp-index)";

export async function fetchWithRetry(fetchFn: Fetch, url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchFn(url, { ...init, headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status} from ${url}`);
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt));
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson<T>(fetchFn: Fetch, url: string): Promise<T | undefined> {
  const response = await fetchWithRetry(fetchFn, url, { headers: { accept: "application/json" } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return (await response.json()) as T;
}

export async function getBytes(fetchFn: Fetch, url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetchWithRetry(fetchFn, url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new Error(`archive is ${declared} bytes, over the ${maxBytes} byte limit`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > maxBytes) throw new Error(`archive is ${body.length} bytes, over the ${maxBytes} byte limit`);
  return body;
}
