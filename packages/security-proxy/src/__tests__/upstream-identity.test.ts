import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { ConsentPages } from "../gateway/consent.js";
import { Gateway } from "../gateway/gateway.js";
import { connectHttpUpstream, type Upstream } from "../gateway/upstream.js";
import { TokenStore, UpstreamCredentials, type OAuthPerUserAuth, type TokenExchangeAuth } from "../gateway/upstream-auth.js";
import type { AuditEvent } from "../types.js";
import { gatewayConfig, textOf } from "./fakes.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const body = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

/** A token the fake authorization server issues: readable JSON in a JWT shape. */
const mint = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, string>;

/** Authorization server: token exchange, authorization code (PKCE checked), refresh. */
async function authorizationServer() {
  const codes = new Map<string, { user: string; challenge: string; scope: string; redirect: string }>();
  const exchanges: URLSearchParams[] = [];
  const base = await listen(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    if (url.pathname === "/authorize") {
      // Signs the user in as "gh-" + login_hint-less user; the test picks the user by a query param it adds
      const code = `code-${codes.size + 1}`;
      codes.set(code, { user: url.searchParams.get("test_user") ?? "octocat", challenge: url.searchParams.get("code_challenge")!, scope: url.searchParams.get("scope") ?? "", redirect: url.searchParams.get("redirect_uri")! });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state")!);
      back.searchParams.set("iss", base);
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    const form = new URLSearchParams(await body(req));
    const grant = form.get("grant_type");
    if (grant === "urn:ietf:params:oauth:grant-type:token-exchange") {
      exchanges.push(form);
      const subject = claimsOf(form.get("subject_token")!);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: mint({ sub: `${subject["sub"]}@files`, aud: form.get("audience"), scope: form.get("scope") }), expires_in: 300, scope: form.get("scope"), issued_token_type: "urn:ietf:params:oauth:token-type:access_token" }));
      return;
    }
    if (grant === "authorization_code") {
      const entry = codes.get(form.get("code")!);
      codes.delete(form.get("code")!);
      const { createHash } = await import("node:crypto");
      const ok = entry && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === entry.challenge && form.get("redirect_uri") === entry.redirect;
      if (!ok) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: mint({ sub: entry.user, scope: entry.scope }), expires_in: 300, scope: entry.scope, refresh_token: "r" }));
      return;
    }
    res.writeHead(400).end();
  });
  return { base, exchanges };
}

/** An MCP server over Streamable HTTP (JSON answers) that says who called it; delete_file needs files:write. */
async function upstreamServer() {
  const authorizations: (string | undefined)[] = [];
  const url = await listen(async (req, res) => {
    const auth = req.headers.authorization;
    authorizations.push(auth);
    const message = JSON.parse((await body(req)) || "{}") as { id?: number; method: string; params?: { name?: string } };
    if (message.id === undefined) return void res.writeHead(202).end();
    const claims = auth ? claimsOf(auth.replace(/^Bearer /, "")) : {};
    const reply = (result: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    if (message.method === "initialize") return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "files", version: "1" } });
    if (message.method === "tools/list") {
      return reply({ tools: [{ name: "whoami", inputSchema: { type: "object" } }, { name: "delete_file", inputSchema: { type: "object" } }] });
    }
    if (message.method === "tools/call" && message.params?.name === "delete_file" && !(claims["scope"] ?? "").split(" ").includes("files:write")) {
      res.writeHead(403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="files:write"' }).end();
      return;
    }
    return reply({ content: [{ type: "text", text: `${message.params?.name} as ${claims["sub"]} (scope: ${claims["scope"] ?? ""})` }] });
  });
  return { url, authorizations };
}

function gatewayFor(upstream: Upstream, events: AuditEvent[], identity: { user: string; token?: string }) {
  const audit = { log: (e: AuditEvent) => events.push(e), close: async () => {} } as unknown as AuditLogger;
  return new Gateway([upstream], gatewayConfig({ taint: { mode: "off", basis: "capability" } }), audit, undefined, { identity: { groups: [], ...identity } });
}

describe("token exchange: each user acts as themselves downstream", () => {
  it("exchanges the caller's token, never forwards it, gives two users two identities and steps up on insufficient_scope", async () => {
    const as = await authorizationServer();
    const files = await upstreamServer();
    const auth: TokenExchangeAuth = { mode: "token-exchange", tokenEndpoint: `${as.base}/token`, clientId: "guardbee-gateway", clientSecret: "x", audience: "files-api", scopes: ["files:read"], toolScopes: {}, clientAuth: "client_secret_basic" };
    const steps: string[] = [];
    const credentials = new UpstreamCredentials("files", auth, { events: { onStepUp: (e) => steps.push(`${e.user} ${e.to.join(" ")}`) } });
    const upstream = await connectHttpUpstream("files", { url: files.url, protocol: "2025-11-25", auth }, { credentials });
    cleanups.push(() => upstream.close());

    const inbound = { alice: mint({ sub: "alice", aud: "guardbee-gateway" }), bob: mint({ sub: "bob", aud: "guardbee-gateway" }) };
    const aliceEvents: AuditEvent[] = [];
    const bobEvents: AuditEvent[] = [];
    const alice = gatewayFor(upstream, aliceEvents, { user: "alice", token: inbound.alice });
    const bob = gatewayFor(upstream, bobEvents, { user: "bob", token: inbound.bob });
    await alice.listTools();
    await bob.listTools();
    expect(textOf(await alice.callTool("files__whoami", {}))).toBe("whoami as alice@files (scope: files:read)");
    expect(textOf(await bob.callTool("files__whoami", {}))).toBe("whoami as bob@files (scope: files:read)");

    // Audit: who called the gateway, and who the upstream saw
    expect(aliceEvents.find((e) => e.type === "tool_response")).toMatchObject({ user: "alice", upstreamIdentity: "alice@files" });
    expect(bobEvents.find((e) => e.type === "tool_response")).toMatchObject({ user: "bob", upstreamIdentity: "bob@files" });

    // Step-up: the upstream refuses with insufficient_scope; the gateway exchanges for more and retries once
    expect(textOf(await alice.callTool("files__delete_file", {}))).toBe("delete_file as alice@files (scope: files:read files:write)");
    expect(steps).toEqual(["alice files:read files:write"]);

    // No passthrough: the inbound tokens never reached the upstream
    expect(files.authorizations.every((a) => a !== undefined)).toBe(true);
    expect(files.authorizations.some((a) => a!.includes(inbound.alice) || a!.includes(inbound.bob))).toBe(false);
    expect(as.exchanges.map((f) => [f.get("subject_token") === inbound.alice ? "alice" : "bob", f.get("audience")])).toContainEqual(["bob", "files-api"]);
  });

  it("refuses a caller without a signed-in identity", async () => {
    const files = await upstreamServer();
    const auth: TokenExchangeAuth = { mode: "token-exchange", tokenEndpoint: "http://127.0.0.1:9/token", clientId: "g", scopes: [], toolScopes: {}, clientAuth: "client_secret_basic" };
    const upstream = await connectHttpUpstream("files", { url: files.url, protocol: "2025-11-25", auth }, { credentials: new UpstreamCredentials("files", auth) });
    cleanups.push(() => upstream.close());
    const events: AuditEvent[] = [];
    const audit = { log: (e: AuditEvent) => events.push(e), close: async () => {} } as unknown as AuditLogger;
    const anonymous = new Gateway([upstream], gatewayConfig({ taint: { mode: "off", basis: "capability" } }), audit);
    expect(await anonymous.listTools()).toEqual([]);
    expect(events.find((e) => e.type === "warn")?.reason).toMatch(/sign in to the gateway/);
    expect(files.authorizations).toEqual([]);
  });
});

describe("oauth-per-user: consent page", () => {
  async function setup() {
    const as = await authorizationServer();
    const files = await upstreamServer();
    const auth: OAuthPerUserAuth = { mode: "oauth-per-user", authorizationEndpoint: `${as.base}/authorize`, tokenEndpoint: `${as.base}/token`, clientId: "gw", issuer: as.base, scopes: ["repo:read"], toolScopes: {}, clientAuth: "client_secret_post" };
    const credentials = new Map<string, UpstreamCredentials>();
    const consentEvents: string[] = [];
    let consent!: ConsentPages;
    const gatewayUrl = await listen(async (req, res) => {
      const url = new URL(req.url!, "http://x");
      if (!(await consent.handle(req, res, url, () => body(req)))) res.writeHead(404).end();
    });
    consent = new ConsentPages({ publicUrl: gatewayUrl, key: Buffer.alloc(32, 9), credentials, onEvent: (e) => consentEvents.push(`${e.user} ${e.outcome}`) });
    const creds = new UpstreamCredentials("gh", auth, { store: new TokenStore(Buffer.alloc(32, 9)), links: consent });
    credentials.set("gh", creds);
    const upstream = await connectHttpUpstream("gh", { url: files.url, protocol: "2025-11-25", auth }, { credentials: creds });
    cleanups.push(() => upstream.close());
    return { as, files, consent, gatewayUrl, upstream, consentEvents };
  }

  /** The browser: open the link, press Allow, follow the authorization server back to the callback. */
  async function approve(link: string, testUser: string) {
    const page = await fetch(link);
    const html = await page.text();
    const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    const t = /name="t" value="([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&");
    const submitted = await fetch(new URL("/oauth/consent", link), { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, csrf, decision: "allow" }) });
    const authorize = new URL(submitted.headers.get("location")!);
    authorize.searchParams.set("test_user", testUser);
    const back = await fetch(authorize, { redirect: "manual" });
    return { page, authorize, callback: await fetch(back.headers.get("location")!) };
  }

  it("offers a connect tool, then the real tools after consent; each user connects their own account", async () => {
    const { upstream, consentEvents } = await setup();
    const aliceEvents: AuditEvent[] = [];
    const alice = gatewayFor(upstream, aliceEvents, { user: "alice" });
    const listed = await alice.listTools();
    expect(listed.map((t) => t.name)).toEqual(["gh__connect_account"]);
    const result = await alice.callTool("gh__connect_account", {});
    const link = /https?:\/\/\S+/.exec(textOf(result))![0];

    const { page, authorize, callback } = await approve(link, "alice-gh");
    // Clickjacking and caching protections on the consent page
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
    // PKCE and the one exact redirect URI
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toMatch(/\/oauth\/callback$/);
    expect(callback.status).toBe(200);
    expect(consentEvents).toEqual(["alice connected"]);

    // The same session: the connect tool was not pinned, so the real tools are not a "rug pull"
    expect((await alice.listTools()).map((t) => t.name).sort()).toEqual(["gh__delete_file", "gh__whoami"]);
    expect(aliceEvents.filter((e) => e.type === "blocked")).toEqual([]);
    expect(textOf(await alice.callTool("gh__whoami", {}))).toBe("whoami as alice-gh (scope: repo:read)");
    // Bob has not connected: his own consent, not Alice's account
    const bob = gatewayFor(upstream, [], { user: "bob" });
    expect((await bob.listTools()).map((t) => t.name)).toEqual(["gh__connect_account"]);
  });

  it("refuses a forged form, a reused link and a replayed callback", async () => {
    const { upstream } = await setup();
    const alice = gatewayFor(upstream, [], { user: "alice" });
    await alice.listTools();
    const link = /https?:\/\/\S+/.exec(textOf(await alice.callTool("gh__connect_account", {})))![0];
    const page = await fetch(link);
    const html = await page.text();
    const t = /name="t" value="([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&");
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;
    // Cross-site POST: no cookie
    const forged = await fetch(new URL("/oauth/consent", link), { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, csrf, decision: "allow" }) });
    expect(forged.status).toBe(403);
    // A tampered link
    expect((await fetch(link.replace(/t=([^&]{5})/, "t=AAAAA"))).status).toBe(400);
    // Used once
    const { callback } = await approve(link, "alice-gh");
    expect(callback.status).toBe(200);
    expect((await fetch(link)).status).toBe(400);
    // The callback's state is single use
    expect((await fetch(callback.url)).status).toBe(400);
  });
});
