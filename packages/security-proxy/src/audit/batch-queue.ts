import type { AuditEvent } from "../types.js";

const MAX_QUEUE = 10_000;

/** What happened to a batch: sent, try again later, or never sendable (drop it). */
export type SendOutcome = { ok: true } | { retry: true } | { drop: true; reason: string };

export interface BatchQueueOptions {
  /** Names the destination in warnings, e.g. "dashboard" or "splunk". */
  name: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

/**
 * Audit events queued and sent in batches, off the request path: a tool call
 * never waits for a SIEM or the dashboard. A batch that fails for a passing
 * reason stays queued (up to MAX_QUEUE, oldest dropped first) for the next
 * flush; one the destination will never accept is dropped with one warning
 * per reason.
 */
export class BatchQueue {
  private queue: AuditEvent[] = [];
  private inFlight: Promise<void> | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private warned = new Set<string>();
  /** Events lost to overflow or a refused batch since the last successful send. */
  dropped = 0;

  constructor(
    private readonly options: BatchQueueOptions,
    private readonly send: (batch: AuditEvent[], dropped: number) => Promise<SendOutcome>,
  ) {
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? 5000);
    this.timer.unref?.();
  }

  private get batchSize(): number {
    return this.options.batchSize ?? 100;
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

  /** Send everything queued; resolves when done or when the destination is unreachable. */
  flush(): Promise<void> {
    this.inFlight ??= this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.batchSize);
      let outcome: SendOutcome;
      try {
        outcome = await this.send(batch, this.dropped);
      } catch {
        return; // offline or timed out: keep the batch for the next flush
      }
      if ("retry" in outcome) return;
      this.queue.splice(0, batch.length);
      if ("ok" in outcome) {
        this.dropped = 0;
        continue;
      }
      this.dropped += batch.length;
      if (!this.warned.has(outcome.reason)) {
        this.warned.add(outcome.reason);
        process.stderr.write(`[guardbee-proxy] ${this.options.name} refused audit events: ${outcome.reason}; those events stay only in the local audit log\n`);
      }
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
