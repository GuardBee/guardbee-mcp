import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConsentRequired,
  TokenStore,
  UpstreamCredentials,
  exchangeToken,
  insufficientScope,
  pkcePair,
  scopesFor,
  sign,
  tokenSubject,
  verify,
  type OAuthPerUserAuth,
  type TokenExchangeAuth,
} from "../gateway/upstream-auth.js";

const exchange: TokenExchangeAuth = {
  mode: "token-exchange",
  tokenEndpoint: "https://idp.example/token",
  clientId: "guardbee-gateway",
  clientSecret: "s3cret",
  audience: "files-api",
  resource: "https://files.example/mcp",
  scopes: ["files:read"],
  toolScopes: { "delete_*": ["files:write"], "admin_*": ["files:admin", "files:write"] },
  clientAuth: "client_secret_basic",
};

function tokenEndpoint(answer: (form: URLSearchParams) => Record<string, unknown>, status = 200) {
  const requests: { form: URLSearchParams; authorization: string | null }[] = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    requests.push({ form, authorization: new Headers(init?.headers).get("authorization") });
    return Response.json(answer(form), { status });
  };
  return { fetch, requests };
}

describe("token exchange (RFC 8693)", () => {
  it("sends the caller's token as subject_token with audience, resource and scope, client authenticated with Basic", async () => {
    const { fetch, requests } = tokenEndpoint(() => ({ access_token: "downstream", expires_in: 300, scope: "files:read" }));
    const token = await exchangeToken(exchange, "inbound-jwt", ["files:read"], fetch);
    expect(token).toMatchObject({ accessToken: "downstream", scopes: ["files:read"] });
    const { form, authorization } = requests[0]!;
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "inbound-jwt",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: "files-api",
      resource: "https://files.example/mcp",
      scope: "files:read",
    });
    expect(authorization).toBe(`Basic ${Buffer.from("guardbee-gateway:s3cret").toString("base64")}`);
  });

  it("reports the authorization server's refusal", async () => {
    const { fetch } = tokenEndpoint(() => ({ error: "access_denied", error_description: "client not allowed to exchange" }), 403);
    await expect(exchangeToken(exchange, "t", [], fetch)).rejects.toThrow(/client not allowed to exchange/);
  });
});

describe("scopes", () => {
  it("adds toolScopes for the tool being called", () => {
    expect(scopesFor(exchange)).toEqual(["files:read"]);
    expect(scopesFor(exchange, "delete_file")).toEqual(["files:read", "files:write"]);
    expect(scopesFor(exchange, "admin_reset")).toEqual(["files:admin", "files:read", "files:write"]);
    expect(scopesFor(exchange, "read_file")).toEqual(["files:read"]);
  });

  it("reads insufficient_scope from WWW-Authenticate", () => {
    expect(insufficientScope('Bearer error="insufficient_scope", scope="files:write files:read"')).toEqual(["files:write", "files:read"]);
    expect(insufficientScope('Bearer error="invalid_token"')).toBeUndefined();
    expect(insufficientScope(null)).toBeUndefined();
  });
});

describe("credentials for a caller", () => {
  it("exchanges once per user and token, and steps up when a tool needs more", async () => {
    let n = 0;
    const { fetch, requests } = tokenEndpoint((form) => ({ access_token: `t${++n}`, expires_in: 300, scope: form.get("scope") }));
    const steps: string[] = [];
    const creds = new UpstreamCredentials("files", exchange, { fetch, events: { onStepUp: (e) => steps.push(`${e.user}: ${e.from.join(" ")} → ${e.to.join(" ")}`) } });
    const alice = { user: "alice", token: "alice-jwt" };
    expect((await creds.tokenFor(alice, ["files:read"])).accessToken).toBe("t1");
    expect((await creds.tokenFor(alice, ["files:read"])).accessToken).toBe("t1");
    expect((await creds.tokenFor(alice, scopesFor(exchange, "delete_file"))).accessToken).toBe("t2");
    expect((await creds.tokenFor({ user: "bob", token: "bob-jwt" }, ["files:read"])).accessToken).toBe("t3");
    expect(requests.map((r) => r.form.get("subject_token"))).toEqual(["alice-jwt", "alice-jwt", "bob-jwt"]);
    expect(steps).toEqual(["alice: files:read → files:read files:write"]);
  });

  it("needs the caller's token", async () => {
    await expect(new UpstreamCredentials("files", exchange).tokenFor({ user: "alice" }, [])).rejects.toThrow(/OIDC/);
  });

  it("per-user OAuth: asks for consent without a token, refreshes an expired one", async () => {
    const perUser: OAuthPerUserAuth = { mode: "oauth-per-user", authorizationEndpoint: "https://as.example/authorize", tokenEndpoint: "https://as.example/token", clientId: "gw", scopes: ["repo:read"], toolScopes: {}, clientAuth: "client_secret_post" };
    const store = new TokenStore(Buffer.alloc(32, 7));
    const links = { consentUrl: (u: string, user: string, scopes: string[]) => `https://gw.example/oauth/consent?u=${u}&s=${user}&sc=${scopes.join("+")}` };
    let now = 1_000_000;
    const { fetch, requests } = tokenEndpoint(() => ({ access_token: "refreshed", expires_in: 60 }));
    const creds = new UpstreamCredentials("gh", perUser, { store, links, fetch, now: () => now });
    await expect(creds.tokenFor({ user: "alice" }, ["repo:read"])).rejects.toBeInstanceOf(ConsentRequired);
    store.set("gh", "alice", { accessToken: "old", expiresAt: now + 10_000, scopes: ["repo:read"], refreshToken: "r1" });
    expect((await creds.tokenFor({ user: "alice" }, ["repo:read"])).accessToken).toBe("refreshed");
    expect(Object.fromEntries(requests[0]!.form)).toMatchObject({ grant_type: "refresh_token", refresh_token: "r1", client_id: "gw" });
    // More scopes than granted: consent again, for the union
    const err = await creds.tokenFor({ user: "alice" }, ["repo:read", "repo:write"]).catch((e) => e);
    expect(err).toBeInstanceOf(ConsentRequired);
    expect((err as ConsentRequired).scopes).toEqual(["repo:read", "repo:write"]);
    // Another user has their own slot
    await expect(creds.tokenFor({ user: "bob" }, ["repo:read"])).rejects.toBeInstanceOf(ConsentRequired);
    now += 0;
  });
});

describe("token store", () => {
  it("encrypts tokens at rest and refuses another key", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gb-tokens-")), "tokens.enc");
    const key = Buffer.alloc(32, 1);
    new TokenStore(key, file).set("gh", "alice", { accessToken: "gho_secretvalue", scopes: ["repo"] });
    expect(fs.readFileSync(file).includes("gho_secretvalue")).toBe(false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(new TokenStore(key, file).get("gh", "alice")?.accessToken).toBe("gho_secretvalue");
    expect(() => new TokenStore(Buffer.alloc(32, 2), file)).toThrow(/cannot be decrypted/);
    expect(() => new TokenStore(Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe("signed state and PKCE", () => {
  it("rejects a tampered or expired value", () => {
    const key = Buffer.alloc(32, 3);
    const value = sign(key, { u: "gh", exp: Date.now() + 1000 });
    expect(verify<{ u: string; exp: number }>(key, value)?.u).toBe("gh");
    const [body, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "evil", exp: Date.now() + 1000 })).toString("base64url");
    expect(verify(key, `${forged}.${mac}`)).toBeUndefined();
    expect(verify(key, `${body}.${mac}`, Date.now() + 5000)).toBeUndefined();
    expect(verify(Buffer.alloc(32, 4), value)).toBeUndefined();
  });

  it("makes an S256 challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("names the subject of a JWT access token for the audit record", () => {
    const jwt = `x.${Buffer.from(JSON.stringify({ sub: "1234", preferred_username: "alice" })).toString("base64url")}.y`;
    expect(tokenSubject(jwt)).toBe("alice");
    expect(tokenSubject("opaque-token")).toBeUndefined();
  });
});

describe("auth config", () => {
  const yaml = (upstream: string, extra = "") => `version: 1\nupstreams:\n  files:\n${upstream}${extra}`;

  it("validates where auth applies and keeps secrets out of the file", async () => {
    const { parseGatewayYaml } = await import("../gateway/config.js");
    const { upstreamIdentities } = await import("../proxy.js");
    expect(() => parseGatewayYaml(yaml("    command: node\n    auth: { mode: token-exchange, tokenEndpoint: https://idp/token, clientId: g }\n"))).toThrow(/auth applies to HTTP upstreams/);
    expect(() =>
      parseGatewayYaml(yaml("    url: https://files.example/mcp\n    headers: { Authorization: Bearer x }\n    auth: { mode: token-exchange, tokenEndpoint: https://idp/token, clientId: g }\n")),
    ).toThrow(/remove it from headers/);
    expect(() => parseGatewayYaml(yaml("    url: https://files.example/mcp\n    auth: { mode: token-exchange, tokenEndpoint: https://idp/token, clientId: g, clientSecretEnv: GB_TEST_MISSING_SECRET }\n"))).toThrow(/GB_TEST_MISSING_SECRET/);
    expect(() =>
      parseGatewayYaml(yaml("    url: https://files.example/mcp\n    auth: { mode: oauth-per-user, authorizationEndpoint: http://as.example/authorize, tokenEndpoint: https://as.example/token, clientId: g }\n")),
    ).toThrow(/https/);

    // token exchange needs callers signed in with OIDC over HTTP
    const stdio = parseGatewayYaml(yaml("    url: https://files.example/mcp\n    auth: { mode: token-exchange, tokenEndpoint: https://idp/token, clientId: g }\n"));
    const audit = { log: () => {}, close: async () => {} } as never;
    expect(() => upstreamIdentities(stdio, audit)).toThrow(/listen.oidc/);
    const perUser = parseGatewayYaml(yaml("    url: https://files.example/mcp\n    auth: { mode: oauth-per-user, authorizationEndpoint: https://as.example/authorize, tokenEndpoint: https://as.example/token, clientId: g }\n"));
    expect(() => upstreamIdentities(perUser, audit)).toThrow(/upstreamAuth/);

    process.env["GB_TEST_TOKEN_KEY"] = Buffer.alloc(32, 5).toString("base64");
    const configured = parseGatewayYaml(
      yaml(
        "    url: https://files.example/mcp\n    auth: { mode: oauth-per-user, authorizationEndpoint: https://as.example/authorize, tokenEndpoint: https://as.example/token, clientId: g, scopes: [repo] }\n",
        "listen: { transport: http }\nupstreamAuth: { publicUrl: https://gw.example/, encryptionKeyEnv: GB_TEST_TOKEN_KEY, tokenFile: /tmp/gb-test-tokens.enc }\n",
      ),
    );
    const identities = upstreamIdentities(configured, audit);
    expect(identities.consent?.redirectUri).toBe("https://gw.example/oauth/callback");
    expect(identities.credentials.get("files")?.auth.mode).toBe("oauth-per-user");
    delete process.env["GB_TEST_TOKEN_KEY"];
  });
});
