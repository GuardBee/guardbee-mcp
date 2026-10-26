import { RedisClient, type RedisReply } from "./redis.js";

/**
 * Where quota and budget counters live. In memory they belong to one proxy
 * process; in Redis every replica counts against the same numbers. Keys carry
 * their window start, so a window ends when its key expires.
 */
export interface WindowCount {
  key: string;
  limit: number;
  ttlMs: number;
}

export type SpendLimit = "requests" | "tokens" | "costUsd";

export interface SpendCount {
  key: string;
  limits: Partial<Record<SpendLimit, number>>;
  ttlMs: number;
}

export interface SpendAdd {
  key: string;
  tokens: number;
  costUsd: number;
  ttlMs: number;
}

export interface CounterBackend {
  /** Count one call in every key, unless one is at its limit: then count nothing and return its index. -1 when counted. */
  take(entries: readonly WindowCount[]): Promise<number>;
  /** The same for spend: count one request in every key unless one has used up a limit. */
  admit(entries: readonly SpendCount[]): Promise<{ index: number; full: SpendLimit } | null>;
  /** Add what a finished request used. */
  add(entries: readonly SpendAdd[]): Promise<void>;
  close(): Promise<void>;
}

/** The counters cannot be reached and `onError: fail-closed`: the call is refused. */
export class CountersUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`shared counters unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "CountersUnavailableError";
  }
}

const MAX_KEYS = 50_000;

export class MemoryCounters implements CounterBackend {
  private readonly counts = new Map<string, { expiresAt: number; requests: number; tokens: number; costUsd: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private entry(key: string, ttlMs: number) {
    const at = this.now();
    let entry = this.counts.get(key);
    if (!entry || entry.expiresAt <= at) {
      entry = { expiresAt: at + ttlMs, requests: 0, tokens: 0, costUsd: 0 };
      this.counts.set(key, entry);
      if (this.counts.size > MAX_KEYS) for (const [k, e] of this.counts) if (e.expiresAt <= at) this.counts.delete(k);
    }
    return entry;
  }

  async take(entries: readonly WindowCount[]): Promise<number> {
    const counted = entries.map((e) => this.entry(e.key, e.ttlMs));
    const full = entries.findIndex((e, i) => counted[i]!.requests >= e.limit);
    if (full !== -1) return full;
    for (const entry of counted) entry.requests++;
    return -1;
  }

  async admit(entries: readonly SpendCount[]): Promise<{ index: number; full: SpendLimit } | null> {
    const counted = entries.map((e) => this.entry(e.key, e.ttlMs));
    for (const [index, e] of entries.entries()) {
      const spent = counted[index]!;
      for (const limit of ["requests", "tokens", "costUsd"] as const) {
        const max = e.limits[limit];
        if (max !== undefined && spent[limit] >= max) return { index, full: limit };
      }
    }
    for (const entry of counted) entry.requests++;
    return null;
  }

  async add(entries: readonly SpendAdd[]): Promise<void> {
    for (const e of entries) {
      const entry = this.entry(e.key, e.ttlMs);
      entry.tokens += e.tokens;
      entry.costUsd += e.costUsd;
    }
  }

  async close(): Promise<void> {}
}

// Check every key, then count in all of them: one script, so replicas never interleave.
// The expiry is set once per window (PTTL < 0), which also works before Redis 7 (no PEXPIRE NX).
const TAKE = `
for i = 1, #KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then return i end
end
for i = 1, #KEYS do
  redis.call('INCR', KEYS[i])
  if redis.call('PTTL', KEYS[i]) < 0 then redis.call('PEXPIRE', KEYS[i], ARGV[#KEYS + i]) end
end
return 0`;

// ARGV per key: requests, tokens and cost limits (-1: none), ttl
const ADMIT = `
local fields = {'requests', 'tokens', 'cost'}
for i = 1, #KEYS do
  for f = 1, 3 do
    local limit = tonumber(ARGV[(i - 1) * 4 + f])
    if limit >= 0 and tonumber(redis.call('HGET', KEYS[i], fields[f]) or '0') >= limit then return {i, f} end
  end
end
for i = 1, #KEYS do
  redis.call('HINCRBY', KEYS[i], 'requests', 1)
  if redis.call('PTTL', KEYS[i]) < 0 then redis.call('PEXPIRE', KEYS[i], ARGV[(i - 1) * 4 + 4]) end
end
return 0`;

const ADD = `
for i = 1, #KEYS do
  redis.call('HINCRBY', KEYS[i], 'tokens', ARGV[(i - 1) * 3 + 1])
  redis.call('HINCRBYFLOAT', KEYS[i], 'cost', ARGV[(i - 1) * 3 + 2])
  if redis.call('PTTL', KEYS[i]) < 0 then redis.call('PEXPIRE', KEYS[i], ARGV[(i - 1) * 3 + 3]) end
end
return 0`;

/**
 * Counters in Redis. Every key gets the `{prefix}` hash tag, so all of them
 * sit in one slot and a script may touch several on a Redis Cluster too.
 */
export class RedisCounters implements CounterBackend {
  constructor(
    readonly client: RedisClient,
    private readonly prefix = "guardbee",
  ) {}

  private keys(entries: readonly { key: string }[]): string[] {
    return entries.map((e) => `{${this.prefix}}:${e.key}`);
  }

  async take(entries: readonly WindowCount[]): Promise<number> {
    if (entries.length === 0) return -1;
    const reply = await this.client.command("EVAL", TAKE, entries.length, ...this.keys(entries), ...entries.map((e) => e.limit), ...entries.map((e) => Math.ceil(e.ttlMs)));
    return Number(reply) - 1;
  }

  async admit(entries: readonly SpendCount[]): Promise<{ index: number; full: SpendLimit } | null> {
    if (entries.length === 0) return null;
    const args = entries.flatMap((e) => [e.limits.requests ?? -1, e.limits.tokens ?? -1, e.limits.costUsd ?? -1, Math.ceil(e.ttlMs)]);
    const reply: RedisReply = await this.client.command("EVAL", ADMIT, entries.length, ...this.keys(entries), ...args);
    if (!Array.isArray(reply)) return null;
    const limits: SpendLimit[] = ["requests", "tokens", "costUsd"];
    return { index: Number(reply[0]) - 1, full: limits[Number(reply[1]) - 1]! };
  }

  async add(entries: readonly SpendAdd[]): Promise<void> {
    if (entries.length === 0) return;
    const args = entries.flatMap((e) => [Math.round(e.tokens), e.costUsd.toFixed(9), Math.ceil(e.ttlMs)]);
    await this.client.command("EVAL", ADD, entries.length, ...this.keys(entries), ...args);
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export type CountersOnError = "local" | "fail-open" | "fail-closed";

/**
 * A shared backend with a rule for when it cannot be reached: `local` counts
 * in this process meanwhile (default), `fail-open` lets calls through
 * uncounted, `fail-closed` refuses them. `onOutage` is told once per outage
 * and `onRecovery` when the backend answers again.
 */
export class ResilientCounters implements CounterBackend {
  private down = false;

  constructor(
    private readonly primary: CounterBackend,
    private readonly onError: CountersOnError,
    private readonly hooks: { onOutage?: (err: unknown) => void; onRecovery?: () => void } = {},
    private readonly local: CounterBackend = new MemoryCounters(),
  ) {}

  private async run<T>(call: (backend: CounterBackend) => Promise<T>, open: T): Promise<T> {
    try {
      const result = await call(this.primary);
      if (this.down) {
        this.down = false;
        this.hooks.onRecovery?.();
      }
      return result;
    } catch (err) {
      if (!this.down) {
        this.down = true;
        this.hooks.onOutage?.(err);
      }
      if (this.onError === "local") return call(this.local);
      if (this.onError === "fail-open") return open;
      throw new CountersUnavailableError(err);
    }
  }

  take(entries: readonly WindowCount[]): Promise<number> {
    return this.run((b) => b.take(entries), -1);
  }

  admit(entries: readonly SpendCount[]): Promise<{ index: number; full: SpendLimit } | null> {
    return this.run((b) => b.admit(entries), null);
  }

  async add(entries: readonly SpendAdd[]): Promise<void> {
    // Usage after the fact is never a reason to fail a request that already ran
    await this.run((b) => b.add(entries), undefined).catch(() => {});
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.primary.close(), this.local.close()]);
  }
}
