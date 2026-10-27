import type { AuditEvent, DashboardSinkConfig } from "../types.js";
import { BatchQueue } from "./batch-queue.js";

const REQUEST_TIMEOUT_MS = 10_000;
/** Retrying these cannot succeed: a bad payload or a bad / under-scoped key. */
const PERMANENT = new Set([400, 401, 403, 404, 413, 422]);

type Fetch = typeof fetch;

/** Sends audit events to the GuardBee dashboard in batches (see BatchQueue). */
export class DashboardSink {
  private readonly queue: BatchQueue;

  constructor(config: DashboardSinkConfig, fetchImpl: Fetch = fetch) {
    this.queue = new BatchQueue(
      { name: "dashboard", ...(config.batchSize ? { batchSize: config.batchSize } : {}), ...(config.flushIntervalMs ? { flushIntervalMs: config.flushIntervalMs } : {}) },
      async (events, dropped) => {
        const response = await fetchImpl(config.url, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ source: config.source, dropped, events }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const status = response.status;
        if (status >= 200 && status < 300) return { ok: true };
        if (PERMANENT.has(status)) {
          return {
            drop: true,
            reason: `HTTP ${status}` + (status === 401 || status === 403 ? " — check the API key and its gateway.write scope" : ""),
          };
        }
        return { retry: true }; // 429 / 5xx
      },
    );
  }

  push(event: AuditEvent): void {
    this.queue.push(event);
  }

  flush(): Promise<void> {
    return this.queue.flush();
  }

  get pending(): number {
    return this.queue.pending;
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}
