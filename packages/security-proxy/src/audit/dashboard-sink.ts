import type { AuditEvent, DashboardSinkConfig } from "../types.js";

const MAX_QUEUE = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Retrying these cannot succeed: a bad payload or a bad / under-scoped key. */
const PERMANENT = new Set([400, 401, 403, 404, 413, 422]);

type Fetch = typeof fetch;

/**
 * Sends audit events to the GuardBee dashboard in batches, off the request
 * path: a tool call never waits for it. Events that could not be sent stay
 * queued (up to MAX_QUEUE, oldest dropped first) and go out with the next flush.
 */
export class DashboardSink {
  private queue: AuditEvent[] = [];
  private inFlight: Promise<void> | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private dropped = 0;
  private warnedStatus: number | null = null;

  constructor(
    private readonly config: DashboardSinkConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.timer = setInterval(() => void this.flush(), config.flushIntervalMs ?? 5000);
    this.timer.unref?.();
  }

  private get batchSize(): number {
    return this.config.batchSize ?? 100;
  }

  push(event: AuditEvent): void {
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE) {
      const overflow = this.queue.length - MAX_QUEUE;
      this.queue.splice(0, overflow);
      this.dropped += overflow;
    }
    if (this.queue.length >= this.batchSize) void this.flush();
  }

  /** Send everything queued; resolves when done or when the endpoint is unreachable. */
  flush(): Promise<void> {
    this.inFlight ??= this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.batchSize);
      let status: number;
      try {
        const response = await this.fetchImpl(this.config.url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ source: this.config.source, dropped: this.dropped, events: batch }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        status = response.status;
      } catch {
        return; // offline or timed out: keep the batch for the next flush
      }
      if (status >= 200 && status < 300) {
        this.queue.splice(0, batch.length);
        this.dropped = 0;
        continue;
      }
      if (PERMANENT.has(status)) {
        this.queue.splice(0, batch.length);
        this.dropped += batch.length;
        if (this.warnedStatus !== status) {
          this.warnedStatus = status;
          process.stderr.write(
            `[guardbee-proxy] dashboard rejected audit events with HTTP ${status}` +
              (status === 401 || status === 403 ? " — check the API key and its gateway.write scope" : "") +
              "; those events stay only in the local audit log\n",
          );
        }
        continue;
      }
      return; // 429 / 5xx: try again later
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
