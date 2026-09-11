import type { RateLimitConfig } from "./config";

type Window = {
  count: number;
  resetAt: number; // epoch ms
};

/**
 * Fixed-window rate limiter.
 *
 * İki kural katmanı:
 *   - global   : tüm tool çağrıları için toplam limit
 *   - per-table: her tablo için ayrı limit (query_table çağrılarında)
 *
 * LLM döngüye girip yüzlerce sorgu atmasını engeller.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly config: RateLimitConfig) {}

  /**
   * Belirtilen anahtar için bir istek sayar ve limiti kontrol eder.
   *
   * @returns allowed   → isteğe izin verildi
   * @returns retryAfterMs → kalan pencere süresi (ms), limit aşılınca > 0
   */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    if (!this.config.enabled) return { allowed: true, retryAfterMs: 0 };

    const now = Date.now();
    const limit = this.limitFor(key);
    let win = this.windows.get(key);

    // Pencere süresi dolduysa sıfırla
    if (!win || now >= win.resetAt) {
      win = { count: 0, resetAt: now + this.config.windowMs };
      this.windows.set(key, win);
    }

    win.count++;

    if (win.count > limit) {
      return { allowed: false, retryAfterMs: win.resetAt - now };
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  /** Mevcut sayım bilgisini döner (monitoring için). */
  status(key: string): { count: number; limit: number; resetAt: number } | null {
    const win = this.windows.get(key);
    if (!win) return null;
    return { count: win.count, limit: this.limitFor(key), resetAt: win.resetAt };
  }

  private limitFor(key: string): number {
    return key.startsWith("table:") ? this.config.maxRequestsPerTable : this.config.maxRequests;
  }
}
