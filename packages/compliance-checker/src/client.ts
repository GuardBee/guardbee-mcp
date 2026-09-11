// GuardBee API v1 client (shared with vulnerability scanner pattern)

const DEFAULT_BASE_URL = "https://app.guardbee.ai";

export type ScanStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface Scan {
  id: string;
  url: string;
  status: ScanStatus;
  score: number | null;
  createdAt: string;
  finishedAt: string | null;
  modules?: Array<{ moduleId: string; moduleName: string; status: string; score: number | null; summary: string | null }>;
  summary?: { critical: number; high: number; medium: number; low: number; info: number; passed: number };
}

export interface Finding {
  id: string;
  scanId: string;
  moduleId: string;
  title: string;
  severity: Severity;
  status: string | null;
  description: string | null;
  recommendation: string | null;
  cveId: string | null;
  documentationUrl: string | null;
}

export interface ListResult<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export class GuardBeeApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "GuardBeeApiError";
  }
}

export class GuardBeeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v) url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/json", "X-API-Key": this.apiKey },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json() as { ok: boolean; data?: T; error?: string; code?: string };
    if (!res.ok || !json.ok) {
      throw new GuardBeeApiError(json.error ?? `HTTP ${res.status}`, res.status, json.code);
    }
    return json.data as T;
  }

  async createScan(opts: { url?: string; brandId?: string; scenario?: string; modules?: string[] }): Promise<Scan> {
    return this.request<Scan>("POST", "/scans", opts);
  }

  async getScan(id: string): Promise<Scan> {
    return this.request<Scan>("GET", `/scans/${id}`);
  }

  async listFindings(opts: { scanId?: string; severity?: string; page?: number; pageSize?: number } = {}): Promise<ListResult<Finding>> {
    return this.request<ListResult<Finding>>("GET", "/findings", undefined, {
      ...(opts.scanId ? { scanId: opts.scanId } : {}),
      ...(opts.severity ? { severity: opts.severity } : {}),
      page: String(opts.page ?? 1),
      pageSize: String(opts.pageSize ?? 100),
    });
  }

  async waitForScan(id: string, maxWaitMs = 600_000): Promise<Scan> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const scan = await this.getScan(id);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(scan.status)) return scan;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    throw new GuardBeeApiError(`Scan ${id} did not finish within ${maxWaitMs / 1000}s`, 408);
  }
}

export function clientFromEnv(): GuardBeeClient {
  const apiKey = process.env["GUARDBEE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "GUARDBEE_API_KEY environment variable is not set. Get your API key from https://app.guardbee.ai/developers"
    );
  }
  return new GuardBeeClient(apiKey, process.env["GUARDBEE_BASE_URL"] ?? DEFAULT_BASE_URL);
}
