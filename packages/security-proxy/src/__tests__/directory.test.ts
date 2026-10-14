import { describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { cnOf, createDirectory, escapeFilter, withDirectoryGroups, type DirectoryConfig, type LdapClient } from "../directory.js";
import { parseGatewayYaml } from "../gateway/config.js";
import { startHttpGateway } from "../http-server.js";
import { gatewayConfig } from "./fakes.js";

const base: DirectoryConfig = {
  url: "ldap://dir",
  bindDn: "cn=svc,dc=acme",
  bindPassword: "pw",
  baseDn: "ou=people,dc=acme",
  userFilter: "(mail={user})",
  groupAttribute: "memberOf",
  groupName: "cn",
  cacheSeconds: 300,
  timeoutMs: 1000,
  onError: "deny",
};

type Entries = Record<string, Record<string, unknown>[]>;

/** An LDAP client answering searches from a table keyed by filter. */
function fakeClient(entries: Entries, log: string[] = [], fail = false): () => LdapClient {
  return () => ({
    async bind(dn) {
      log.push(`bind ${dn}`);
      if (fail) throw new Error("connect ECONNREFUSED");
    },
    async search(baseDn, { filter }) {
      log.push(`search ${baseDn} ${filter}`);
      return { searchEntries: entries[filter] ?? [] };
    },
    async unbind() {},
  });
}

describe("directory helpers", () => {
  it("escapes filter values (RFC 4515) so a user name cannot widen the search", () => {
    expect(escapeFilter("*)(uid=*")).toBe("\\2a\\29\\28uid=\\2a");
    expect(escapeFilter("a\\b")).toBe("a\\5cb");
  });

  it("takes the CN of a group DN", () => {
    expect(cnOf("CN=Platform Eng,OU=Groups,DC=acme,DC=com")).toBe("Platform Eng");
    expect(cnOf("cn=Sales\\, EMEA,ou=groups")).toBe("Sales, EMEA");
    expect(cnOf("ou=odd")).toBe("ou=odd");
  });
});

describe("createDirectory", () => {
  it("reads memberOf, caches, and does not cache a failure", async () => {
    const log: string[] = [];
    let now = 0;
    const dir = createDirectory(base, fakeClient({ "(mail=alice@acme.com)": [{ dn: "uid=alice,ou=people", memberOf: ["CN=eng,OU=G", "CN=admins,OU=G"] }] }, log), () => now);
    expect(await dir.groupsOf("alice@acme.com")).toEqual(["eng", "admins"]);
    expect(await dir.groupsOf("alice@acme.com")).toEqual(["eng", "admins"]);
    expect(log.filter((l) => l.startsWith("search"))).toHaveLength(1);
    now = 301_000;
    await dir.groupsOf("alice@acme.com");
    expect(log.filter((l) => l.startsWith("search"))).toHaveLength(2);
    expect(await dir.groupsOf("nobody@acme.com")).toEqual([]);

    const broken = createDirectory(base, fakeClient({}, [], true));
    await expect(broken.groupsOf("alice@acme.com")).rejects.toThrow(/directory lookup failed/);
  });

  it("searches groups by member DN, escaping the DN", async () => {
    const log: string[] = [];
    const config = { ...base, groupAttribute: undefined, groupSearch: { baseDn: "ou=groups,dc=acme", filter: "(member={dn})", nameAttribute: "cn" } } as DirectoryConfig;
    const dir = createDirectory(
      config,
      fakeClient({ "(mail=bob)": [{ dn: "uid=bob(x),ou=people" }], "(member=uid=bob\\28x\\29,ou=people)": [{ dn: "cn=ops,ou=groups", cn: "ops" }] }, log),
    );
    expect(await dir.groupsOf("bob")).toEqual(["ops"]);
    expect(log).toContain("search ou=groups,dc=acme (member=uid=bob\\28x\\29,ou=people)");
  });

  it("withDirectoryGroups: union with token groups; onError decides", async () => {
    const dir = createDirectory(base, fakeClient({ "(mail=a)": [{ dn: "x", memberOf: "CN=eng,OU=G" }] }));
    expect(await withDirectoryGroups(dir, "deny", "a", ["oidc-group", "eng"])).toEqual(["oidc-group", "eng"]);
    expect(await withDirectoryGroups(dir, "deny", undefined, ["g"])).toEqual(["g"]);
    const broken = createDirectory(base, fakeClient({}, [], true));
    expect(await withDirectoryGroups(broken, "token-groups", "a", ["g"])).toEqual(["g"]);
    await expect(withDirectoryGroups(broken, "deny", "a", ["g"])).rejects.toMatchObject({ status: 503 });
  });
});

describe("listen.ldap in the gateway", () => {
  async function start(fail = false) {
    const audit = { log: () => {}, close: async () => {} } as unknown as AuditLogger;
    const config = gatewayConfig({
      llm: {
        path: "/v1",
        providers: { p: { name: "p", api: "openai", baseUrl: "http://127.0.0.1:9/v1", apiKey: "k", headers: {} } },
        routes: [{ model: "gpt-*", provider: "p" }],
        keys: [{ key: "gb-alice", user: "alice@acme.com", groups: [] }],
        pricing: {},
        budgets: [],
        access: [{ group: "eng", allow: ["gpt-*"] }],
        accessDefault: "deny",
        maskResponses: false,
        timeoutSeconds: 5,
      },
    });
    const listen = { transport: "http" as const, host: "127.0.0.1", port: 0, path: "/mcp", apiKeys: [], maxSessions: 5, ldap: base };
    const gw = await startHttpGateway([], config, audit, listen, { ldapClient: fakeClient({ "(mail=alice@acme.com)": [{ dn: "a", memberOf: ["CN=eng,OU=G"] }] }, [], fail) });
    return gw;
  }

  it("directory groups unlock LLM access; an unreachable directory answers 503", async () => {
    const ok = await start();
    // The upstream is unreachable on purpose: getting past access control is what counts (502, not 403)
    const res = await fetch(`${ok.llmUrl}/chat/completions`, { method: "POST", headers: { authorization: "Bearer gb-alice" }, body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }) });
    expect(res.status).toBe(502);
    await ok.close();

    const down = await start(true);
    const refused = await fetch(`${down.llmUrl}/chat/completions`, { method: "POST", headers: { authorization: "Bearer gb-alice" }, body: JSON.stringify({ model: "gpt-4o", messages: [] }) });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain("directory lookup failed");
    await down.close();
  });

  it("parses listen.ldap with the bind password from the environment", () => {
    process.env["TEST_LDAP_PW"] = "secret";
    const cfg = parseGatewayYaml(`
version: 1
upstreams: { a: { command: x } }
listen:
  transport: http
  apiKeys: ["k"]
  ldap: { url: "ldaps://dc.acme.com", bindDn: "cn=svc,dc=acme", bindPasswordEnv: TEST_LDAP_PW, baseDn: "dc=acme", groupAttribute: memberOf }
`);
    expect(cfg.listen.transport === "http" && cfg.listen.ldap).toMatchObject({ bindPassword: "secret", groupName: "cn", onError: "deny", cacheSeconds: 300 });
    expect(() => parseGatewayYaml("version: 1\nupstreams: { a: { command: x } }\nlisten: { transport: http, ldap: { url: 'ldap://x', bindDn: a, bindPasswordEnv: TEST_LDAP_PW, baseDn: b } }\n")).toThrow(/groupAttribute/);
  });
});
