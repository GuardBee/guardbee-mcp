import { randomBytes } from "crypto";
import { maskPiiInValue } from "@guardbee/guard-core";

const TOKEN = /<pii:[a-z_]+:[0-9a-f]{8}>/g;

/**
 * Session-scoped reversible PII tokens. The model sees `<pii:tc_kimlik:7f3a9b21>`
 * instead of the value, and can still pass that token to another tool; the
 * gateway puts the real value back on the way to the upstream. The table lives
 * only in memory and dies with the session.
 */
export class PiiVault {
  private readonly byToken = new Map<string, string>();
  private readonly byValue = new Map<string, string>();

  get size(): number {
    return this.byToken.size;
  }

  /** Replace validated PII in any JSON-like value with tokens; the same value always gets the same token. */
  tokenize<T>(value: T): T {
    return maskPiiInValue(value, (name, match) => {
      const known = this.byValue.get(match);
      if (known) return known;
      let token: string;
      do token = `<pii:${name}:${randomBytes(4).toString("hex")}>`;
      while (this.byToken.has(token));
      this.byToken.set(token, match);
      this.byValue.set(match, token);
      return token;
    }) as T;
  }

  /** Put real values back for tokens this session issued; unknown tokens stay as they are. */
  detokenize<T>(value: T): T {
    if (typeof value === "string") {
      return value.replace(TOKEN, (token) => this.byToken.get(token) ?? token) as T;
    }
    if (Array.isArray(value)) return value.map((item) => this.detokenize(item)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.detokenize(v)])) as T;
    }
    return value;
  }

  /** True if the value carries a token this session issued. */
  holdsTokens(value: unknown): boolean {
    if (typeof value === "string") return (value.match(TOKEN) ?? []).some((token) => this.byToken.has(token));
    if (Array.isArray(value)) return value.some((item) => this.holdsTokens(item));
    if (value && typeof value === "object") return Object.values(value).some((v) => this.holdsTokens(v));
    return false;
  }
}
