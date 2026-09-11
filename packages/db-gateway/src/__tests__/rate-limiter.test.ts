import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RateLimiter } from "../rate-limiter";
import type { RateLimitConfig } from "../config";

const cfg: RateLimitConfig = {
  enabled: true,
  windowMs: 60_000,
  maxRequests: 3,
  maxRequestsPerTable: 2,
};

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enabled=false → her zaman allowed", () => {
    const rl = new RateLimiter({ ...cfg, enabled: false });
    for (let i = 0; i < 100; i++) {
      expect(rl.check("global").allowed).toBe(true);
    }
  });

  it("global limit: limitin altında allowed", () => {
    const rl = new RateLimiter(cfg);
    expect(rl.check("global").allowed).toBe(true);
    expect(rl.check("global").allowed).toBe(true);
    expect(rl.check("global").allowed).toBe(true);
  });

  it("global limit: limit+1 istekte denied", () => {
    const rl = new RateLimiter(cfg);
    rl.check("global");
    rl.check("global");
    rl.check("global");
    const result = rl.check("global");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("per-table limit: table: prefix key'de maxRequestsPerTable uygulanır", () => {
    const rl = new RateLimiter(cfg);
    rl.check("table:users");
    rl.check("table:users");
    const result = rl.check("table:users");
    expect(result.allowed).toBe(false);
  });

  it("farklı tablolar bağımsız sayılır", () => {
    const rl = new RateLimiter(cfg);
    rl.check("table:users");
    rl.check("table:users");
    // users limiti doldu ama orders hâlâ serbest
    expect(rl.check("table:orders").allowed).toBe(true);
  });

  it("pencere süresi dolunca sayaç sıfırlanır", () => {
    const rl = new RateLimiter(cfg);
    rl.check("global");
    rl.check("global");
    rl.check("global");
    expect(rl.check("global").allowed).toBe(false);

    // Pencereyi ilerlet
    vi.advanceTimersByTime(60_001);
    expect(rl.check("global").allowed).toBe(true);
  });

  it("status() mevcut pencere bilgisini döner", () => {
    const rl = new RateLimiter(cfg);
    expect(rl.status("global")).toBeNull(); // henüz sorgu yok
    rl.check("global");
    const s = rl.status("global");
    expect(s?.count).toBe(1);
    expect(s?.limit).toBe(3);
  });

  it("retryAfterMs pencere bitimine yaklaşık eşit", () => {
    const rl = new RateLimiter(cfg);
    rl.check("global");
    rl.check("global");
    rl.check("global");
    vi.advanceTimersByTime(30_000); // pencerenin yarısında
    const result = rl.check("global");
    expect(result.allowed).toBe(false);
    // retryAfterMs ≈ 30_000 (±100ms tolerans)
    expect(result.retryAfterMs).toBeLessThanOrEqual(30_000);
    expect(result.retryAfterMs).toBeGreaterThan(29_000);
  });
});
