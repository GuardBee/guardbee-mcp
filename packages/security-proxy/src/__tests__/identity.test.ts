import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AuditLogger } from "../audit/logger.js";
import { createAuthenticator, type OidcConfig } from "../auth.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import { startHttpGateway } from "../http-server.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let signing: KeyPair;
let stranger: KeyPair;
let jwk: JWK;

beforeAll(async () => {
  signing = await generateKeyPair("RS256");
  stranger = await generateKeyPair("RS256");
  jwk = { ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
});

/** A minimal OpenID provider: discovery document and JWKS. */
async function identityProvider(): Promise<{ issuer: string; discoveries: () => number }> {
  let discoveries = 0;
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === "/.well-known/openid-configuration") {
      discoveries++;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ issuer: base, jwks_uri: `${base}/jwks` }));
    } else if (req.url === "/jwks") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return { issuer: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, discoveries: () => discoveries };
}

async function token(
  issuer: string,
  claims: Record<string, unknown> = {},
  options: { audience?: string; key?: KeyPair; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience(options.audience ?? "guardbee-gateway")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign((options.key ?? signing).privateKey);
}

const oidc = (issuer: string, extra: Partial<OidcConfig> = {}): OidcConfig => ({
  issuer,
  audience: ["guardbee-gateway"],
  userClaim: "sub",
  groupsClaim: "groups",
  ...extra,
});

describe("authenticator", () => {
  it("lets anyone in when there are no keys and no OIDC (loopback only)", async () => {
    expect(await createAuthenticator([])(undefined)).toEqual({ via: "apiKey", groups: [] });
  });

  it("checks API keys", async () => {
    const auth = createAuthenticator(["k-one", "k-two"]);
    expect(await auth("Bearer k-two")).toEqual({ via: "apiKey", groups: [] });
    expect(await auth("Bearer nope")).toBeNull();
    expect(await auth(undefined)).toBeNull();
  });

  it("accepts a valid token found through discovery, with user and groups", async () => {
    const idp = await identityProvider();
    const auth = createAuthenticator([], oidc(idp.issuer));
    const identity = await auth(`Bearer ${await token(idp.issuer, { sub: "ayse", groups: ["finance", "admins"] })}`);
    expect(identity).toEqual({ via: "oidc", user: "ayse", groups: ["finance", "admins"] });
    await auth(`Bearer ${await token(idp.issuer, { sub: "mehmet" })}`);
    expect(idp.discoveries()).toBe(1);
  });

  it("reads other claims and space-separated groups", async () => {
    const idp = await identityProvider();
    const auth = createAuthenticator([], oidc(idp.issuer, { userClaim: "email", groupsClaim: "roles" }));
    const identity = await auth(`Bearer ${await token(idp.issuer, { sub: "x", email: "ayse@acme.test", roles: "read write" })}`);
    expect(identity).toEqual({ via: "oidc", user: "ayse@acme.test", groups: ["read", "write"] });
  });

  it("refuses a wrong audience, a wrong issuer, an expired token, a foreign key, and no user claim", async () => {
    const idp = await identityProvider();
    const auth = createAuthenticator([], oidc(idp.issuer));
    const refused = [
      await token(idp.issuer, { sub: "a" }, { audience: "some-other-api" }),
      await token("https://evil.test", { sub: "a" }),
      await token(idp.issuer, { sub: "a" }, { expiresIn: "-1m" }),
      await token(idp.issuer, { sub: "a" }, { key: stranger }),
      await token(idp.issuer, { email: "no-sub@acme.test" }),
      // alg "none": an unsigned token
      `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ iss: idp.issuer, aud: "guardbee-gateway", sub: "a" })).toString("base64url")}.`,
    ];
    for (const t of refused) expect(await auth(`Bearer ${t}`)).toBeNull();
  });

  it("accepts an API key next to OIDC", async () => {
    const idp = await identityProvider();
    const auth = createAuthenticator(["ops-key"], oidc(idp.issuer));
    expect(await auth("Bearer ops-key")).toEqual({ via: "apiKey", groups: [] });
  });
});

describe("HTTP gateway with OIDC", () => {
  async function gateway(overrides: Partial<GatewayConfig> = {}) {
    const idp = await identityProvider();
    const crm = fakeUpstream("crm", [{ name: "export_all", returns: "exported" }, { name: "search", returns: "3 results" }]);
    const logger = new AuditLogger({ enabled: false, sink: "console" });
    const events: AuditEvent[] = [];
    vi.spyOn(logger, "log").mockImplementation((event) => void events.push(event));
    const listen = { transport: "http" as const, host: "127.0.0.1", port: 0, path: "/mcp", apiKeys: [], oidc: oidc(idp.issuer), maxSessions: 10 };
    const gw = await startHttpGateway([crm], gatewayConfig(overrides), logger, listen);
    cleanups.push(() => gw.close());
    return { gw, idp, crm, events };
  }

  async function connect(url: string, bearer: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
    const client = new Client({ name: "agent", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    cleanups.push(() => client.close());
    return client;
  }

  it("answers 401 with the protected resource metadata, and serves that metadata", async () => {
    const { gw, idp } = await gateway();
    const res = await fetch(gw.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    const origin = new URL(gw.url).origin;
    expect(res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);

    const metadata = await (await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(metadata).toEqual({ resource: gw.url, authorization_servers: [idp.issuer], bearer_methods_supported: ["header"] });
  });

  it("tags audit events with the user and matches rules on user and group", async () => {
    const { gw, idp, crm, events } = await gateway({
      rules: [
        { id: "finance-exports", match: { tool: "crm__export_all", group: "finance" }, action: "allow" },
        { id: "no-exports", match: { tool: "crm__export_all" }, action: "deny" },
        { id: "no-contractors", match: { user: "*@contractor.test" }, action: "deny" },
      ],
    });
    const ayse = await connect(gw.url, await token(idp.issuer, { sub: "ayse@acme.test", groups: ["finance"] }));
    const ali = await connect(gw.url, await token(idp.issuer, { sub: "ali@acme.test", groups: ["sales"] }));
    const temp = await connect(gw.url, await token(idp.issuer, { sub: "x@contractor.test" }));

    expect(textOf((await ayse.callTool({ name: "crm__export_all", arguments: {} })) as never)).toBe("exported");
    expect(((await ali.callTool({ name: "crm__export_all", arguments: {} })) as { isError?: boolean }).isError).toBe(true);
    expect(((await temp.callTool({ name: "crm__search", arguments: {} })) as { isError?: boolean }).isError).toBe(true);
    expect(crm.calls.map((c) => c.tool)).toEqual(["export_all"]);

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call", user: "ayse@acme.test", ruleId: "finance-exports" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "blocked", user: "ali@acme.test", ruleId: "no-exports" }));
  });

  it("does not let another user's token continue a session", async () => {
    const { gw, idp } = await gateway();
    const transport = new StreamableHTTPClientTransport(new URL(gw.url), {
      requestInit: { headers: { authorization: `Bearer ${await token(idp.issuer, { sub: "ayse" })}` } },
    });
    const client = new Client({ name: "agent", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    cleanups.push(() => client.close());

    const res = await fetch(gw.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": transport.sessionId!,
        authorization: `Bearer ${await token(idp.issuer, { sub: "mallory" })}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("listen.oidc config", () => {
  const base = "version: 1\nupstreams:\n  crm:\n    command: node\n";

  it("parses with defaults and lets a non-loopback listener rely on OIDC", () => {
    const config = parseGatewayYaml(
      `${base}listen:\n  transport: http\n  host: 0.0.0.0\n  oidc:\n    issuer: https://login.acme.test\n    audience: guardbee-gateway\n`,
    );
    expect(config.listen).toMatchObject({
      oidc: { issuer: "https://login.acme.test", audience: ["guardbee-gateway"], userClaim: "sub", groupsClaim: "groups" },
    });
  });

  it("requires an audience", () => {
    expect(() => parseGatewayYaml(`${base}listen:\n  transport: http\n  oidc:\n    issuer: https://login.acme.test\n`)).toThrow(/audience/);
  });

  it("parses user and group in rules", () => {
    const config = parseGatewayYaml(`${base}rules:\n  - match: { group: finance, user: "*@acme.test" }\n    action: allow\n`);
    expect(config.rules[0]?.match).toEqual({ group: "finance", user: "*@acme.test" });
  });
});
