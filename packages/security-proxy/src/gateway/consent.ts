import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type http from "http";
import { pkcePair, sign, verify, type ConsentLinks, type UpstreamCredentials } from "./upstream-auth.js";

/**
 * The consent page of oauth-per-user upstreams: a user connects their own
 * account at a third-party authorization server, once, from a link the
 * gateway gave them (the upstream's connect_account tool, or a tool call
 * that needed it).
 *
 *   GET  /oauth/consent?t=…   what is asked (upstream, user, scopes); Allow / Cancel
 *   POST /oauth/consent       CSRF-checked; redirects to the authorization server (PKCE S256, state)
 *   GET  /oauth/callback      exact redirect URI; state single-use; RFC 9207 iss checked; code redeemed
 *
 * The link is signed, bound to the user and the upstream, valid ten minutes
 * and usable once. Pages cannot be framed (CSP frame-ancestors 'none',
 * X-Frame-Options DENY) or cached.
 */

const LINK_TTL_MS = 10 * 60_000;
const CSRF_COOKIE = "gb_consent_csrf";

interface LinkPayload {
  u: string; // upstream
  s: string; // user
  sc: string[]; // scopes
  n: string; // nonce: single use
  exp: number;
}

interface Pending {
  upstream: string;
  user: string;
  verifier: string;
  exp: number;
}

export interface ConsentOptions {
  publicUrl: string;
  key: Buffer;
  credentials: Map<string, UpstreamCredentials>;
  /** A user connected an upstream: refresh tool lists. */
  onConnected?: (upstream: string, user: string) => void;
  /** Audit: consent given, refused or failed. */
  onEvent?: (event: { upstream: string; user: string; outcome: "connected" | "cancelled" | "failed"; reason?: string; scopes?: string[] }) => void;
  now?: () => number;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class ConsentPages implements ConsentLinks {
  private readonly usedNonces = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  /** HMAC key for links: derived from the encryption key, never the key itself. */
  private readonly linkKey: Buffer;

  constructor(private readonly options: ConsentOptions) {
    this.linkKey = createHash("sha256").update(options.key).update("guardbee consent links").digest();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  get redirectUri(): string {
    return `${this.options.publicUrl}/oauth/callback`;
  }

  consentUrl(upstream: string, user: string, scopes: string[]): string {
    const t = sign(this.linkKey, { u: upstream, s: user, sc: scopes, n: randomBytes(12).toString("base64url"), exp: this.now() + LINK_TTL_MS } satisfies LinkPayload);
    return `${this.options.publicUrl}/oauth/consent?t=${encodeURIComponent(t)}`;
  }

  private sweep(): void {
    const now = this.now();
    for (const [nonce, exp] of this.usedNonces) if (exp < now) this.usedNonces.delete(nonce);
    for (const [state, pending] of this.pending) if (pending.exp < now) this.pending.delete(state);
  }

  private send(res: http.ServerResponse, status: number, html: string, extraHeaders: Record<string, string | string[]> = {}, formAction = "'self'"): void {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
      ...extraHeaders,
    });
    res.end(html);
  }

  private page(title: string, body: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#1a1a1a}h1{font-size:22px}code{background:#f2f2f2;padding:1px 5px;border-radius:4px}.actions{display:flex;gap:12px;margin-top:24px}button{font:inherit;padding:8px 18px;border-radius:6px;border:1px solid #888;background:#fff;cursor:pointer}button.allow{background:#1a7f37;color:#fff;border-color:#1a7f37}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}code{background:#21262d}button{background:#21262d;color:#e6edf3}}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
  }

  private error(res: http.ServerResponse, status: number, message: string): void {
    this.send(res, status, this.page("Cannot continue", `<p>${escapeHtml(message)}</p><p>Ask the agent for a new link (call the upstream's <code>connect_account</code> tool).</p>`));
  }

  private authorizationOrigin(upstream: string): string {
    const credentials = this.options.credentials.get(upstream);
    return credentials?.auth.mode === "oauth-per-user" ? new URL(credentials.auth.authorizationEndpoint).origin : "'self'";
  }

  /** Handles /oauth/consent and /oauth/callback; false for any other path. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, readBody: () => Promise<string>): Promise<boolean> {
    if (url.pathname !== "/oauth/consent" && url.pathname !== "/oauth/callback") return false;
    this.sweep();
    if (url.pathname === "/oauth/consent" && req.method === "GET") return this.showConsent(res, url), true;
    if (url.pathname === "/oauth/consent" && req.method === "POST") return await this.submitConsent(req, res, await readBody()), true;
    if (url.pathname === "/oauth/callback" && req.method === "GET") return await this.callback(res, url), true;
    res.writeHead(405, { allow: url.pathname === "/oauth/consent" ? "GET, POST" : "GET" }).end();
    return true;
  }

  private link(t: string | null): LinkPayload | undefined {
    if (!t) return undefined;
    const payload = verify<LinkPayload>(this.linkKey, t, this.now());
    if (!payload || this.usedNonces.has(payload.n) || !this.options.credentials.has(payload.u)) return undefined;
    return payload;
  }

  private showConsent(res: http.ServerResponse, url: URL): void {
    const t = url.searchParams.get("t");
    const link = this.link(t);
    if (!link) return this.error(res, 400, "This link is invalid, expired or already used.");
    const csrf = randomBytes(24).toString("base64url");
    const secure = this.options.publicUrl.startsWith("https:") ? "; Secure" : "";
    const scopes = link.sc.length ? link.sc.map((s) => `<code>${escapeHtml(s)}</code>`).join(" ") : "the default access";
    this.send(
      res,
      200,
      this.page(
        `Connect ${link.u}`,
        `<p>The GuardBee gateway asks to act as you at <strong>${escapeHtml(link.u)}</strong>, for <strong>${escapeHtml(link.s)}</strong>, with ${scopes}.</p>
<p>You will sign in at ${escapeHtml(this.authorizationOrigin(link.u))} next. The token is stored encrypted on the gateway and used only for your own requests.</p>
<form method="post" action="/oauth/consent"><input type="hidden" name="t" value="${escapeHtml(t!)}"><input type="hidden" name="csrf" value="${csrf}">
<div class="actions"><button class="allow" type="submit" name="decision" value="allow">Allow</button><button type="submit" name="decision" value="cancel">Cancel</button></div></form>`,
      ),
      { "set-cookie": `${CSRF_COOKIE}=${csrf}; Path=/oauth; HttpOnly; SameSite=Strict; Max-Age=600${secure}` },
      `'self' ${this.authorizationOrigin(link.u)}`,
    );
  }

  private async submitConsent(req: http.IncomingMessage, res: http.ServerResponse, body: string): Promise<void> {
    const form = new URLSearchParams(body);
    const cookie = /(?:^|;\s*)gb_consent_csrf=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
    const given = form.get("csrf") ?? "";
    const same = cookie.length > 0 && cookie.length === given.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(given));
    if (!same) return this.error(res, 403, "The form could not be verified (missing or mismatched CSRF token). Open the link again.");
    const link = this.link(form.get("t"));
    if (!link) return this.error(res, 400, "This link is invalid, expired or already used.");
    this.usedNonces.set(link.n, link.exp);
    const clear = { "set-cookie": `${CSRF_COOKIE}=; Path=/oauth; HttpOnly; SameSite=Strict; Max-Age=0` };
    if (form.get("decision") !== "allow") {
      this.options.onEvent?.({ upstream: link.u, user: link.s, outcome: "cancelled" });
      return this.send(res, 200, this.page("Cancelled", `<p>Nothing was connected. You can close this window.</p>`), clear);
    }
    const credentials = this.options.credentials.get(link.u)!;
    const auth = credentials.auth;
    if (auth.mode !== "oauth-per-user") return this.error(res, 400, "This upstream does not use per-user OAuth.");
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(32).toString("base64url");
    this.pending.set(state, { upstream: link.u, user: link.s, verifier, exp: this.now() + LINK_TTL_MS });
    const authorize = new URL(auth.authorizationEndpoint);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", auth.clientId);
    authorize.searchParams.set("redirect_uri", this.redirectUri);
    if (link.sc.length) authorize.searchParams.set("scope", link.sc.join(" "));
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    if (auth.resource) authorize.searchParams.set("resource", auth.resource);
    res.writeHead(303, { location: authorize.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer", ...clear });
    res.end();
  }

  private async callback(res: http.ServerResponse, url: URL): Promise<void> {
    const state = url.searchParams.get("state") ?? "";
    const pending = this.pending.get(state);
    if (!pending || pending.exp < this.now()) return this.error(res, 400, "Unknown or expired authorization state.");
    // Single use, whatever happens next
    this.pending.delete(state);
    const credentials = this.options.credentials.get(pending.upstream)!;
    const auth = credentials.auth;
    const fail = (reason: string) => {
      this.options.onEvent?.({ upstream: pending.upstream, user: pending.user, outcome: "failed", reason });
      this.error(res, 400, reason);
    };
    if (url.searchParams.get("error")) return fail(`The authorization server refused: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`);
    const iss = url.searchParams.get("iss");
    if (auth.mode === "oauth-per-user" && auth.issuer && iss !== null && iss !== auth.issuer) return fail(`Authorization response from an unexpected issuer (${iss}).`);
    const code = url.searchParams.get("code");
    if (!code) return fail("The authorization server sent no code.");
    try {
      const token = await credentials.redeem(pending.user, code, pending.verifier, this.redirectUri);
      this.options.onEvent?.({ upstream: pending.upstream, user: pending.user, outcome: "connected", scopes: token.scopes });
      this.options.onConnected?.(pending.upstream, pending.user);
    } catch (err) {
      return fail(`The code could not be redeemed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.send(res, 200, this.page(`${pending.upstream} connected`, `<p>Your ${escapeHtml(pending.upstream)} account is connected to the gateway. You can close this window and go back to the agent.</p>`));
  }
}
