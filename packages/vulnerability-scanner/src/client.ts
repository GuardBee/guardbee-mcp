// GuardBee REST API v1 client

const DEFAULT_BASE_URL = "https://app.guardbee.ai";

export type ScanStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type ScanScenario = "quick" | "kvkkFocus" | "gdprFocus" | "ccpaFocus";

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  passed: number;
}

export interface ScanModule {
  moduleId: string;
  moduleName: string;
  status: string;
  score: number | null;
  summary: string | null;
}

export interface Scan {
  id: string;
  url: string;
  status: ScanStatus;
  score: number | null;
  brandId: string | null;
  workspaceId: string | null;
  createdAt: string;
  finishedAt: string | null;
  modules?: ScanModule[];
  summary?: ScanSummary;
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
  createdAt?: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListResult<T> {
  data: T[];
  pagination: Pagination;
}

export interface CreateScanOptions {
  url?: string;
  brandId?: string;
  scenario?: ScanScenario;
  modules?: string[];
}

export interface ListScansOptions {
  brandId?: string;
  status?: ScanStatus;
  page?: number;
  pageSize?: number;
}

export interface ListFindingsOptions {
  scanId?: string;
  brandId?: string;
  severity?: Severity;
  page?: number;
  pageSize?: number;
}

export class GuardBeeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
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

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const json = await res.json() as { ok: boolean; data?: T; error?: string; code?: string };

    if (!res.ok || !json.ok) {
      throw new GuardBeeApiError(
        json.error ?? `HTTP ${res.status}`,
        res.status,
        json.code
      );
    }

    return json.data as T;
  }

  async createScan(opts: CreateScanOptions): Promise<Scan> {
    return this.request<Scan>("POST", "/scans", opts);
  }

  async getScan(id: string): Promise<Scan> {
    return this.request<Scan>("GET", `/scans/${id}`);
  }

  async listScans(opts: ListScansOptions = {}): Promise<ListResult<Scan>> {
    return this.request<ListResult<Scan>>("GET", "/scans", undefined, {
      ...(opts.brandId ? { brandId: opts.brandId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      page: String(opts.page ?? 1),
      pageSize: String(opts.pageSize ?? 20),
    });
  }

  async listFindings(opts: ListFindingsOptions = {}): Promise<ListResult<Finding>> {
    return this.request<ListResult<Finding>>("GET", "/findings", undefined, {
      ...(opts.scanId ? { scanId: opts.scanId } : {}),
      ...(opts.brandId ? { brandId: opts.brandId } : {}),
      ...(opts.severity ? { severity: opts.severity } : {}),
      page: String(opts.page ?? 1),
      pageSize: String(opts.pageSize ?? 20),
    });
  }

  /** Poll scan until COMPLETED/FAILED/CANCELLED or timeout */
  async waitForScan(
    id: string,
    options: { pollIntervalMs?: number; maxWaitMs?: number } = {}
  ): Promise<Scan> {
    const { pollIntervalMs = 5_000, maxWaitMs = 300_000 } = options;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const scan = await this.getScan(id);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(scan.status)) {
        return scan;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new GuardBeeApiError(`Scan ${id} did not finish within ${maxWaitMs / 1000}s`, 408);
  }
}

export function clientFromEnv(): GuardBeeClient {
  const apiKey = process.env["GUARDBEE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "GUARDBEE_API_KEY environment variable is not set. " +
      "Get your API key from https://app.guardbee.ai/developers"
    );
  }
  const baseUrl = process.env["GUARDBEE_BASE_URL"] ?? DEFAULT_BASE_URL;
  return new GuardBeeClient(apiKey, baseUrl);
}
