import { validatePolicy, type GatewayPolicy } from "@guardbee/guard-core";
import type { DashboardSinkConfig } from "../types.js";
import type { GatewayConfig } from "./config.js";

type Fetch = typeof fetch;

export type RefreshResult = "updated" | "unchanged" | "none" | "invalid" | "unreachable";

/**
 * Keeps the policy fields of a GatewayConfig in step with the workspace policy
 * in the GuardBee dashboard. Every session reads rules, taint, approval and
 * interceptors from the shared config on each call, so an update applies to
 * the next call everywhere; labels apply from the next tools/list.
 *
 * Never leaves the proxy without a policy: until the first dashboard policy
 * arrives the local one stays, and an unreachable dashboard or an invalid
 * document keeps the last good one.
 */
export class PolicySync {
  private readonly endpoint: string;
  private etag: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  version: number | null = null;

  constructor(
    private readonly config: GatewayConfig,
    private readonly dashboard: DashboardSinkConfig,
    private readonly refreshSeconds: number,
    private readonly fetchImpl: Fetch = fetch,
    private readonly log: (message: string) => void = (message) => process.stderr.write(`[guardbee-proxy] ${message}\n`),
  ) {
    this.endpoint = new URL("policy", dashboard.url).toString();
  }

  /** First fetch (awaited, so the proxy starts with the dashboard policy when there is one), then periodic refresh. */
  async start(): Promise<RefreshResult> {
    const first = await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshSeconds * 1000);
    this.timer.unref?.();
    return first;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<RefreshResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        headers: {
          authorization: `Bearer ${this.dashboard.apiKey}`,
          ...(this.etag ? { "if-none-match": this.etag } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      this.log(`policy: dashboard unreachable, keeping the ${this.version === null ? "local" : `v${this.version}`} policy`);
      return "unreachable";
    }
    if (res.status === 304) return "unchanged";
    if (res.status === 404) {
      if (this.version === null) this.log("policy: no policy saved in the dashboard yet, using the local one");
      return "none";
    }
    if (!res.ok) {
      this.log(`policy: dashboard answered HTTP ${res.status}, keeping the current policy`);
      return "unreachable";
    }

    const body = (await res.json().catch(() => null)) as { data?: { version?: number; policy?: unknown } } | null;
    const checked = validatePolicy(body?.data?.policy);
    if (!checked.ok) {
      this.log(`policy: rejected the dashboard policy (${checked.issues.slice(0, 3).join("; ")}), keeping the current one`);
      return "invalid";
    }
    if (checked.policy.approval.channels.includes("dashboard") && !this.config.audit.dashboard) {
      this.log("policy: rejected — approval.channels has dashboard but audit.dashboard is not set here");
      return "invalid";
    }

    this.apply(checked.policy);
    this.etag = res.headers.get("etag");
    this.version = typeof body?.data?.version === "number" ? body.data.version : null;
    this.log(`policy: applied v${this.version ?? "?"} from the dashboard`);
    return "updated";
  }

  private apply(policy: GatewayPolicy): void {
    this.config.labels = policy.labels;
    this.config.tools = policy.tools;
    this.config.rules = policy.rules;
    this.config.taint = policy.taint;
    this.config.approval = policy.approval;
    this.config.defaults = policy.defaults;
    this.config.interceptors = policy.interceptors;
  }
}
