// Token exchange against a real Keycloak (standard token exchange, RFC 8693), in docker.
import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthenticator } from "../auth.js";
import type { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import { connectHttpUpstream, type Upstream } from "../gateway/upstream.js";
import { UpstreamCredentials, type TokenExchangeAuth } from "../gateway/upstream-auth.js";
import type { AuditEvent } from "../types.js";
import { gatewayConfig, textOf } from "./fakes.js";

const IMAGE = "quay.io/keycloak/keycloak:26.4";
const REALM_DIR = fileURLToPath(new URL("./fixtures/keycloak", import.meta.url));

const dockerUp = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
})();

const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;

describe.runIf(dockerUp)("token exchange with Keycloak", () => {
  let container = "";
  let issuer = "";
  let upstreamUrl = "";
  let upstreamServer: http.Server | undefined;
  const seen: Record<string, unknown>[] = [];
  const authorizations: string[] = [];

  beforeAll(async () => {
    container = execFileSync(
      "docker",
      ["run", "-d", "--rm", "-p", "127.0.0.1::8080", "-v", `${REALM_DIR}:/opt/keycloak/data/import:ro`, "-e", "KC_BOOTSTRAP_ADMIN_USERNAME=admin", "-e", "KC_BOOTSTRAP_ADMIN_PASSWORD=admin", IMAGE, "start-dev", "--import-realm"],
      { encoding: "utf8" },
    ).trim();
    const port = execFileSync("docker", ["port", container, "8080/tcp"], { encoding: "utf8" }).trim().split("\n")[0]!.split(":").pop();
    issuer = `http://127.0.0.1:${port}/realms/guardbee`;
    const deadline = Date.now() + 180_000;
    for (;;) {
      const ready = await fetch(`${issuer}/.well-known/openid-configuration`).then((r) => r.ok).catch(() => false);
      if (ready) break;
      if (Date.now() > deadline) throw new Error("Keycloak did not start");
      await new Promise((r) => setTimeout(r, 2000));
    }
    // An MCP server that reports who its token names (the signature is Keycloak's; the test reads the claims)
    upstreamServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const auth = req.headers.authorization ?? "";
        authorizations.push(auth);
        const message = JSON.parse(body || "{}") as { id?: number; method: string };
        if (message.id === undefined) return void res.writeHead(202).end();
        const reply = (result: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        if (message.method === "initialize") return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "files", version: "1" } });
        if (message.method === "tools/list") return reply({ tools: [{ name: "whoami", inputSchema: { type: "object" } }] });
        const claims = claimsOf(auth.replace(/^Bearer /, ""));
        seen.push(claims);
        return reply({ content: [{ type: "text", text: String(claims["preferred_username"]) }] });
      });
    });
    await new Promise<void>((resolve) => upstreamServer!.listen(0, "127.0.0.1", resolve));
    upstreamUrl = `http://127.0.0.1:${(upstreamServer.address() as AddressInfo).port}/mcp`;
  }, 240_000);

  afterAll(async () => {
    if (container) execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    await new Promise((resolve) => (upstreamServer ? upstreamServer.close(resolve) : resolve(undefined)));
  });

  /** The MCP client signs the user in (password grant, for the test) and gets a token for the gateway. */
  const signIn = async (user: string) => {
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", client_id: "mcp-client", username: user, password: "pw" }),
    });
    const json = (await response.json()) as { access_token?: string; error_description?: string };
    if (!json.access_token) throw new Error(`sign-in failed: ${json.error_description}`);
    return json.access_token;
  };

  it("gives alice and bob their own downstream tokens for files-api; their gateway tokens never reach it", async () => {
    const authenticate = createAuthenticator([], { issuer, audience: ["guardbee-gateway"], userClaim: "preferred_username", groupsClaim: "groups" });
    const auth: TokenExchangeAuth = {
      mode: "token-exchange",
      tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
      clientId: "guardbee-gateway",
      clientSecret: "gw-secret",
      audience: "files-api",
      scopes: ["files:read"],
      toolScopes: {},
      clientAuth: "client_secret_basic",
    };
    const upstream: Upstream = await connectHttpUpstream("files", { url: upstreamUrl, protocol: "2025-11-25", auth }, { credentials: new UpstreamCredentials("files", auth) });
    try {
      const results: Record<string, string> = {};
      const inbound: string[] = [];
      for (const user of ["alice", "bob"]) {
        const token = await signIn(user);
        inbound.push(token);
        const identity = await authenticate(`Bearer ${token}`);
        expect(identity?.user).toBe(user);
        const events: AuditEvent[] = [];
        const audit = { log: (e: AuditEvent) => events.push(e), close: async () => {} } as unknown as AuditLogger;
        const gateway = new Gateway([upstream], gatewayConfig({ taint: { mode: "off", basis: "capability" } }), audit, undefined, {
          identity: { user: identity!.user!, groups: identity!.groups, token: identity!.token! },
        });
        await gateway.listTools();
        results[user] = textOf(await gateway.callTool("files__whoami", {}));
        expect(events.find((e) => e.type === "tool_response")).toMatchObject({ user, upstreamIdentity: user });
      }
      expect(results).toEqual({ alice: "alice", bob: "bob" });
      // Downstream tokens: minted by Keycloak for files-api, on behalf of the gateway client, with the requested scope
      expect(seen).toHaveLength(2);
      for (const claims of seen) {
        expect([claims["aud"]].flat()).toContain("files-api");
        expect(claims["azp"]).toBe("guardbee-gateway");
        expect(String(claims["scope"])).toContain("files:read");
      }
      // No passthrough
      expect(authorizations.some((a) => inbound.some((t) => a.includes(t)))).toBe(false);
    } finally {
      await upstream.close();
    }
  }, 120_000);
});
