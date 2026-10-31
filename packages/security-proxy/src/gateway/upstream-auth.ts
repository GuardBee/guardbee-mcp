import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";

/**
 * Upstream identity: which credential the gateway presents to an HTTP
 * upstream on behalf of the caller. The caller's own token is never
 * forwarded (MCP spec: token passthrough is forbidden).
 *
 * - token-exchange: the caller's OIDC access token is exchanged (RFC 8693)
 *   at the authorization server for a token whose audience is the upstream
 *   (Keycloak, Entra ID on-behalf-of, Okta, Auth0). Each user acts as
 *   themselves downstream.
 * - oauth-per-user: each user connects their own account at a third-party
 *   OAuth 2.1 server once, through a consent page the gateway serves
 *   (PKCE, state, CSRF token, exact redirect URI, no framing). Tokens are
 *   stored encrypted, per user and upstream, and refreshed.
 *
 * Both request the smallest set of scopes (auth.scopes, plus toolScopes for
 * the tool being called) and step up when a call needs more: a tool listed
 * in toolScopes, or a 401/403 with WWW-Authenticate error="insufficient_scope".
 */

export interface TokenExchangeAuth {
  mode: "token-exchange";
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  /** RFC 8693 audience: the upstream's client id / app id at the authorization server. */
  audience?: string;
  /** RFC 8707 resource indicator: the upstream URL. */
  resource?: string;
  scopes: string[];
  toolScopes: Record<string, string[]>;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "client_secret_basic" | "client_secret_post";
}

export interface OAuthPerUserAuth {
  mode: "oauth-per-user";
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  /** Expected `iss` in the authorization response (RFC 9207), when the server sends one. */
  issuer?: string;
  resource?: string;
  scopes: string[];
  toolScopes: Record<string, string[]>;
  clientAuth: "client_secret_basic" | "client_secret_post";
}

export type UpstreamAuth = { mode: "static" } | TokenExchangeAuth | OAuthPerUserAuth;

export interface UpstreamToken {
  accessToken: string;
  /** Epoch ms; undefined when the server gave no lifetime. */
  expiresAt?: number;
  scopes: string[];
  refreshToken?: string;
}

export class ConsentRequired extends Error {
  constructor(
    readonly upstream: string,
    readonly url: string,
    readonly scopes: string[],
  ) {
    super(`Connect your ${upstream} account to the gateway first: ${url}`);
    this.name = "ConsentRequired";
  }
}

export class UpstreamAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamAuthError";
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort();
const covers = (granted: readonly string[], needed: readonly string[]) => needed.every((s) => granted.includes(s));

/** Scopes a tool needs: auth.scopes plus every toolScopes pattern the tool name matches (`*` globs). */
export function scopesFor(auth: TokenExchangeAuth | OAuthPerUserAuth, tool?: string): string[] {
  let scopes = [...auth.scopes];
  if (tool) {
    for (const [pattern, extra] of Object.entries(auth.toolScopes)) {
      const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      if (re.test(tool)) scopes = union(scopes, extra);
    }
  }
  return union(scopes, []);
}

/** The scope a 401/403 asks for (WWW-Authenticate: Bearer error="insufficient_scope", scope="a b"). */
export function insufficientScope(header: string | null): string[] | undefined {
  if (!header || !/error="?insufficient_scope"?/i.test(header)) return undefined;
  const scope = /scope="([^"]*)"/i.exec(header)?.[1];
  return scope ? scope.split(/\s+/).filter(Boolean) : [];
}

async function tokenRequest(auth: TokenExchangeAuth | OAuthPerUserAuth, form: Record<string, string>, fetchImpl: Fetch): Promise<UpstreamToken & { raw: Record<string, unknown> }> {
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (auth.clientSecret && auth.clientAuth === "client_secret_basic") {
    headers["authorization"] = `Basic ${Buffer.from(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`).toString("base64")}`;
  } else {
    body.set("client_id", auth.clientId);
    if (auth.clientSecret) body.set("client_secret", auth.clientSecret);
  }
  const response = await fetchImpl(auth.tokenEndpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
  const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof raw["access_token"] !== "string") {
    const why = typeof raw["error_description"] === "string" ? raw["error_description"] : typeof raw["error"] === "string" ? raw["error"] : `HTTP ${response.status}`;
    throw new UpstreamAuthError(`token endpoint refused the request: ${why}`);
  }
  const expiresIn = Number(raw["expires_in"]);
  const granted = typeof raw["scope"] === "string" ? raw["scope"].split(/\s+/).filter(Boolean) : (form["scope"] ?? "").split(/\s+/).filter(Boolean);
  return {
    accessToken: raw["access_token"],
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    scopes: granted,
    ...(typeof raw["refresh_token"] === "string" ? { refreshToken: raw["refresh_token"] } : {}),
    raw,
  };
}

/** RFC 8693: the caller's access token for one with the upstream as audience. */
export async function exchangeToken(auth: TokenExchangeAuth, subjectToken: string, scopes: string[], fetchImpl: Fetch = fetch): Promise<UpstreamToken> {
  const form: Record<string, string> = {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    ...(auth.audience ? { audience: auth.audience } : {}),
    ...(auth.resource ? { resource: auth.resource } : {}),
    ...(scopes.length ? { scope: scopes.join(" ") } : {}),
  };
  const { raw: _raw, ...token } = await tokenRequest(auth, form, fetchImpl);
  return token;
}

// ── PKCE, signed state ──────────────────────────────────────────────────────

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** A tamper-proof, expiring value: base64url(payload).hmac. */
export function sign(secret: Buffer, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verify<T extends { exp: number }>(secret: Buffer, value: string, now = Date.now()): T | undefined {
  const [body, mac] = value.split(".");
  if (!body || !mac) return undefined;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return payload.exp > now ? payload : undefined;
  } catch {
    return undefined;
  }
}

// ── Encrypted per-user token store ──────────────────────────────────────────

/**
 * Tokens of oauth-per-user upstreams, by upstream and user, in a file
 * encrypted with AES-256-GCM (a key of 32 random bytes, from
 * upstreamAuth.encryptionKey). Without a file, they live in memory only.
 */
export class TokenStore {
  private tokens = new Map<string, UpstreamToken>();

  constructor(
    private readonly key: Buffer,
    private readonly file?: string,
  ) {
    if (key.length !== 32) throw new UpstreamAuthError("upstreamAuth.encryptionKey must be 32 bytes, base64 (openssl rand -base64 32)");
    if (file && fs.existsSync(file)) {
      const sealed = fs.readFileSync(file);
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
        decipher.setAuthTag(sealed.subarray(12, 28));
        const plain = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
        this.tokens = new Map(Object.entries(JSON.parse(plain.toString("utf8")) as Record<string, UpstreamToken>));
      } catch {
        throw new UpstreamAuthError(`${file} cannot be decrypted with upstreamAuth.encryptionKey (wrong key, or the file was changed)`);
      }
    }
  }

  private static key(upstream: string, user: string): string {
    return `${upstream}\u0000${user}`;
  }

  get(upstream: string, user: string): UpstreamToken | undefined {
    return this.tokens.get(TokenStore.key(upstream, user));
  }

  set(upstream: string, user: string, token: UpstreamToken): void {
    this.tokens.set(TokenStore.key(upstream, user), token);
    this.save();
  }

  delete(upstream: string, user: string): void {
    if (this.tokens.delete(TokenStore.key(upstream, user))) this.save();
  }

  private save(): void {
    if (!this.file) return;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const sealed = Buffer.concat([cipher.update(JSON.stringify(Object.fromEntries(this.tokens)), "utf8"), cipher.final()]);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat([iv, cipher.getAuthTag(), sealed]), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

// ── The credential source of one upstream ───────────────────────────────────

export interface Caller {
  user: string;
  /** The caller's inbound access token (token-exchange only). Never sent upstream. */
  token?: string;
}

export interface AuthEvents {
  /** A token with more scopes than before was obtained for this user. */
  onStepUp?: (event: { upstream: string; user: string; from: string[]; to: string[]; reason: string }) => void;
  /** A token was issued (exchange, code, refresh). */
  onToken?: (event: { upstream: string; user: string; scopes: string[]; how: "exchange" | "authorization_code" | "refresh" }) => void;
}

export interface ConsentLinks {
  /** URL of the consent page for this user, upstream and scopes. */
  consentUrl(upstream: string, user: string, scopes: string[]): string;
}

const SKEW_MS = 30_000;
const fresh = (token: UpstreamToken | undefined, now: number) => !!token && (token.expiresAt === undefined || token.expiresAt - SKEW_MS > now);

export class UpstreamCredentials {
  /** token-exchange results: by user and subject token, never persisted. */
  private exchanged = new Map<string, UpstreamToken>();

  constructor(
    readonly upstream: string,
    readonly auth: TokenExchangeAuth | OAuthPerUserAuth,
    private readonly options: { store?: TokenStore; links?: ConsentLinks; events?: AuthEvents; fetch?: Fetch; now?: () => number } = {},
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** The current token for this caller with at least `scopes`; obtains, refreshes or steps up as needed. */
  async tokenFor(caller: Caller, scopes: string[], reason = "call"): Promise<UpstreamToken> {
    return this.auth.mode === "token-exchange" ? this.exchanged_(caller, scopes, reason) : this.perUser(caller, scopes, reason);
  }

  /** A previously granted scope set for this caller (what a new call starts from). */
  granted(caller: Caller): string[] {
    if (this.auth.mode === "oauth-per-user") return this.options.store?.get(this.upstream, caller.user)?.scopes ?? [];
    const prefix = `${caller.user}\u0000`;
    let scopes: string[] = [];
    for (const [key, token] of this.exchanged) if (key.startsWith(prefix)) scopes = union(scopes, token.scopes);
    return scopes;
  }

  private async exchanged_(caller: Caller, scopes: string[], reason: string): Promise<UpstreamToken> {
    const auth = this.auth as TokenExchangeAuth;
    if (!caller.token) throw new UpstreamAuthError(`${this.upstream} uses token exchange: the caller must sign in to the gateway with an OIDC access token`);
    const key = `${caller.user}\u0000${createHash("sha256").update(caller.token).digest("hex")}`;
    const current = this.exchanged.get(key);
    if (fresh(current, this.now()) && covers(current!.scopes, scopes)) return current!;
    // Ask for what was already granted plus what is needed now, so scopes do not flap
    const wanted = union(current && fresh(current, this.now()) ? current.scopes : [], scopes);
    const token = await exchangeToken(auth, caller.token, wanted, this.options.fetch);
    // A server that ignores `scope` in the response answers with what it granted; trust the request then
    if (!token.scopes.length) token.scopes = wanted;
    this.exchanged.set(key, token);
    this.options.events?.onToken?.({ upstream: this.upstream, user: caller.user, scopes: token.scopes, how: "exchange" });
    if (current && !covers(current.scopes, wanted)) {
      this.options.events?.onStepUp?.({ upstream: this.upstream, user: caller.user, from: current.scopes, to: token.scopes, reason });
    }
    // Bounded: drop expired entries now and then
    if (this.exchanged.size > 10_000) for (const [k, t] of this.exchanged) if (!fresh(t, this.now())) this.exchanged.delete(k);
    return token;
  }

  private async perUser(caller: Caller, scopes: string[], reason: string): Promise<UpstreamToken> {
    const auth = this.auth as OAuthPerUserAuth;
    const store = this.options.store;
    if (!store) throw new UpstreamAuthError("oauth-per-user needs upstreamAuth (encryptionKey) configured");
    let token = store.get(this.upstream, caller.user);
    if (token && !fresh(token, this.now()) && token.refreshToken) {
      try {
        const { raw: _raw, ...refreshed } = await tokenRequest(auth, { grant_type: "refresh_token", refresh_token: token.refreshToken, ...(auth.resource ? { resource: auth.resource } : {}) }, this.options.fetch ?? fetch);
        token = { ...refreshed, scopes: refreshed.scopes.length ? refreshed.scopes : token.scopes, refreshToken: refreshed.refreshToken ?? token.refreshToken };
        store.set(this.upstream, caller.user, token);
        this.options.events?.onToken?.({ upstream: this.upstream, user: caller.user, scopes: token.scopes, how: "refresh" });
      } catch {
        store.delete(this.upstream, caller.user);
        token = undefined;
      }
    }
    if (token && fresh(token, this.now()) && covers(token.scopes, scopes)) return token;
    // No token, an expired one without refresh, or not enough scopes: the user has to consent (again)
    const wanted = union(token?.scopes ?? [], scopes);
    if (!this.options.links) throw new UpstreamAuthError("oauth-per-user needs upstreamAuth.publicUrl for its consent page");
    if (token) this.options.events?.onStepUp?.({ upstream: this.upstream, user: caller.user, from: token.scopes, to: wanted, reason: `${reason} (consent needed)` });
    throw new ConsentRequired(this.upstream, this.options.links.consentUrl(this.upstream, caller.user, wanted), wanted);
  }

  /** After the consent page and the authorization server: redeem the code (PKCE, exact redirect URI). */
  async redeem(user: string, code: string, verifier: string, redirectUri: string): Promise<UpstreamToken> {
    const auth = this.auth as OAuthPerUserAuth;
    const { raw: _raw, ...token } = await tokenRequest(
      auth,
      { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, ...(auth.resource ? { resource: auth.resource } : {}) },
      this.options.fetch ?? fetch,
    );
    this.options.store?.set(this.upstream, user, token);
    this.options.events?.onToken?.({ upstream: this.upstream, user, scopes: token.scopes, how: "authorization_code" });
    return token;
  }
}

/** The subject of a JWT access token (unverified: for the audit record only), or undefined for an opaque token. */
export function tokenSubject(token: string): string | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
    const who = payload["preferred_username"] ?? payload["upn"] ?? payload["email"] ?? payload["sub"];
    return typeof who === "string" ? who : undefined;
  } catch {
    return undefined;
  }
}
