// GuardBee API v1 client for AI Security Engineer assessments and remediations.

const DEFAULT_BASE_URL = "https://app.guardbee.ai";

export type Platform = "nginx" | "apache" | "express" | "nextjs" | "cloudflare";

export interface AssessmentSummary {
  id: string;
  task: string;
  hostname: string | null;
  status: string;
  riskLevel: string | null;
  createdAt: string;
}

export interface AssessmentFinding {
  id: string;
  priority: number;
  title: string;
  severity: string;
  classification: string;
  ruleId: string | null;
  moduleId: string;
  whyItMatters: string;
  recommendation: string;
  fixPlatforms: Platform[];
  recommendedPlatform: Platform | null;
}

export interface Assessment {
  id: string;
  hostname: string | null;
  status: string;
  riskLevel: string | null;
  target: string | null;
  techStack: { platform: Platform; evidence: string }[];
  findings: AssessmentFinding[];
}

export interface Proposal {
  title: string;
  platformLabel: string;
  strategy: string;
  steps: string[];
  code: { title: string; language: string; code: string }[];
  changes: { label: string; before: string; after: string }[];
  configDiff: string | null;
  configDiffNote: string | null;
  caveats: string[];
  verification: { moduleId: string; description: string };
  findingTitle?: string;
}

export interface Remediation {
  id: string;
  findingId: string;
  platform: Platform;
  status: string;
  proposal: Proposal;
  appliedRef: string | null;
  verification: { outcome: string; detail: string; checkedAt: string } | null;
}

export class GuardBeeApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "GuardBeeApiError";
  }
}

export class GuardBeeClient {
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string, baseUrl: string = DEFAULT_BASE_URL, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Lets GuardBee record that the change came through an MCP client.
        "X-GuardBee-Client": "mcp-security-engineer",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: string; code?: string };
    if (!res.ok) throw new GuardBeeApiError(json.error ?? `GuardBee API error (${res.status})`, res.status, json.code);
    return json.data as T;
  }

  listAssessments(): Promise<AssessmentSummary[]> {
    return this.request("GET", "/security-agent/runs");
  }

  getAssessment(runId: string): Promise<Assessment> {
    return this.request("GET", `/security-agent/runs/${encodeURIComponent(runId)}`);
  }

  proposeFix(runId: string, input: { findingId: string; platform?: Platform; currentConfig?: string }): Promise<Remediation> {
    return this.request("POST", `/security-agent/runs/${encodeURIComponent(runId)}/remediations`, input);
  }

  reportApplied(remediationId: string, ref?: string): Promise<Remediation> {
    return this.request("POST", `/remediations/${encodeURIComponent(remediationId)}/applied`, ref ? { ref } : {});
  }

  verify(remediationId: string): Promise<Remediation> {
    return this.request("POST", `/remediations/${encodeURIComponent(remediationId)}/verify`);
  }
}

export function clientFromEnv(): GuardBeeClient {
  const apiKey = process.env["GUARDBEE_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "GUARDBEE_API_KEY is not set. Create a key with the remediations.read and remediations.write scopes at https://app.guardbee.ai/developers"
    );
  }
  return new GuardBeeClient(apiKey, process.env["GUARDBEE_BASE_URL"] ?? DEFAULT_BASE_URL);
}
