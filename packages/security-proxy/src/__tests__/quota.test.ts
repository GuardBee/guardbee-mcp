import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AuditLogger } from "../audit/logger.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import { Gateway, type CallerIdentity } from "../gateway/gateway.js";
import { QuotaStore, type QuotaRule } from "../gateway/quota.js";
import { startHttpGateway } from "../http-server.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function world(quotas: QuotaRule[], overrides: Partial<GatewayConfig> = {}) {
  let clock = 1_200_000_000; // 20,000 × 60s: a window boundary for 60s and 3600s windows
  const now = () => clock;
  const store = new QuotaStore(now);
  const crm = fakeUpstream("crm", [{ name: "search" }, { name: "export_all" }, { name: "delete" }]);
  const events: AuditEvent[] = [];
  const config = gatewayConfig({
    quotas,
    labels: { crm__delete: ["destructive"] },
    ...overrides,
  });
  const session = (sessionId: string, identity?: CallerIdentity) => {
    const logger = new AuditLogger({ enabled: false, sink: "console" });
    vi.spyOn(logger, "log").mockImplementation((event) => void events.push(event));
    return new Gateway([crm], config, logger, undefined, { sessionId, quotas: store, now, ...(identity ? { identity } : {}) });
  };
  const blocked = async (gw: Gateway, tool: string) => (await gw.callTool(tool, {})).isError === true;
  return { session, crm, events, blocked, advance: (seconds: number) => void (clock += seconds * 1000) };
}

const ayse = { user: "ayse@acme.test", groups: ["finance"] };
const ali = { user: "ali@acme.test", groups: ["sales"] };

describe("quotas", () => {
  it("counts a user's calls across their sessions, and says when to retry", async () => {
    const w = world([{ id: "search-cap", match: { tool: "crm__search" }, limit: 2, windowSeconds: 60, per: "user" }]);
    const first = w.session("s1", ayse);
    const second = w.session("s2", ayse);
    expect(await w.blocked(first, "crm__search")).toBe(false);
    expect(await w.blocked(second, "crm__search")).toBe(false);

    w.advance(15);
    const refused = await second.callTool("crm__search", {});
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('quota search-cap reached: 2 calls per 60s for user "ayse@acme.test"; try again in 45s');
    expect(w.events).toContainEqual(expect.objectContaining({ type: "blocked", ruleId: "quota:search-cap", user: "ayse@acme.test" }));

    // Another user has their own counter
    expect(await w.blocked(w.session("s3", ali), "crm__search")).toBe(false);
    // A new window resets it
    w.advance(45);
    expect(await w.blocked(first, "crm__search")).toBe(false);
  });

  it("per session and per gateway", async () => {
    const perSession = world([{ match: {}, limit: 1, windowSeconds: 60, per: "session" }]);
    expect(await perSession.blocked(perSession.session("a", ayse), "crm__search")).toBe(false);
    expect(await perSession.blocked(perSession.session("b", ayse), "crm__search")).toBe(false);

    const shared = world([{ match: { upstream: "crm" }, limit: 1, windowSeconds: 60, per: "gateway" }]);
    expect(await shared.blocked(shared.session("a", ayse), "crm__search")).toBe(false);
    expect(await shared.blocked(shared.session("b", ali), "crm__search")).toBe(true);
  });

  it("a user quota falls back to the session when there is no signed-in user", async () => {
    const w = world([{ match: {}, limit: 1, windowSeconds: 60, per: "user" }]);
    const a = w.session("a");
    expect(await w.blocked(a, "crm__search")).toBe(false);
    expect(await w.blocked(a, "crm__search")).toBe(true);
    expect(await w.blocked(w.session("b"), "crm__search")).toBe(false);
  });

  it("matches on label, group and user glob", async () => {
    const w = world([
      { id: "deletes", match: { label: "destructive" }, limit: 1, windowSeconds: 3600, per: "gateway" },
      { id: "sales-exports", match: { tool: "crm__export_*", group: "sales" }, limit: 1, windowSeconds: 3600, per: "user" },
      { id: "contractors", match: { user: "*@contractor.test" }, limit: 1, windowSeconds: 3600, per: "user" },
    ]);
    const finance = w.session("f", ayse);
    const sales = w.session("s", ali);
    expect(await w.blocked(finance, "crm__delete")).toBe(false);
    expect(await w.blocked(sales, "crm__delete")).toBe(true);
    // Finance is not in "sales": no export cap for them
    expect(await w.blocked(finance, "crm__export_all")).toBe(false);
    expect(await w.blocked(finance, "crm__export_all")).toBe(false);
    expect(await w.blocked(sales, "crm__export_all")).toBe(false);
    expect(await w.blocked(sales, "crm__export_all")).toBe(true);
    const temp = w.session("t", { user: "x@contractor.test", groups: [] });
    expect(await w.blocked(temp, "crm__search")).toBe(false);
    expect(await w.blocked(temp, "crm__search")).toBe(true);
  });

  it("counts a call against all matching quotas or none of them", async () => {
    const w = world([
      { id: "wide", match: {}, limit: 5, windowSeconds: 60, per: "gateway" },
      { id: "narrow", match: { tool: "crm__export_all" }, limit: 1, windowSeconds: 60, per: "gateway" },
    ]);
    const gw = w.session("a", ayse);
    await gw.callTool("crm__export_all", {}); // wide 1, narrow 1
    for (let i = 0; i < 3; i++) await gw.callTool("crm__export_all", {}); // narrow full: wide must stay at 1
    for (let i = 0; i < 4; i++) expect(await w.blocked(gw, "crm__search")).toBe(false); // wide 2..5
    expect(await w.blocked(gw, "crm__search")).toBe(true);
  });

  it("does not spend quota on calls the policy refuses, and is not counted as probing", async () => {
    const w = world([{ id: "cap", match: {}, limit: 1, windowSeconds: 60, per: "gateway" }], {
      rules: [{ match: { tool: "crm__delete" }, action: "deny" }],
      interceptors: { anomaly: { enabled: true, action: "block", repeatedBlocks: { count: 1, windowSeconds: 300 } } },
    });
    const gw = w.session("a", ayse);
    expect(await w.blocked(gw, "crm__delete")).toBe(true); // denied: no quota spent
    expect(await w.blocked(gw, "crm__search")).toBe(false); // the one allowed call
    expect(await w.blocked(gw, "crm__search")).toBe(true); // quota
    expect(await w.blocked(gw, "crm__search")).toBe(true); // quota again — still not a lockdown
    expect(w.events.filter((e) => e.ruleId === "anomaly:repeated_blocks")).toEqual([]);
    expect(w.crm.calls).toHaveLength(1);
  });
});

describe("quotas over HTTP", () => {
  it("are shared by every session of the process", async () => {
    const crm = fakeUpstream("crm", [{ name: "search", returns: "ok" }]);
    const config = gatewayConfig({ quotas: [{ id: "all", match: {}, limit: 1, windowSeconds: 3600, per: "gateway" }] });
    const listen = { transport: "http" as const, host: "127.0.0.1", port: 0, path: "/mcp", apiKeys: [], maxSessions: 10 };
    const http = await startHttpGateway([crm], config, new AuditLogger({ enabled: false, sink: "console" }), listen);
    cleanups.push(() => http.close());
    const agent = async () => {
      const client = new Client({ name: "agent", version: "0.0.0" }, { capabilities: {} });
      await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
      cleanups.push(() => client.close());
      return client;
    };
    const [a, b] = [await agent(), await agent()];
    expect(textOf((await a.callTool({ name: "crm__search", arguments: {} })) as CallToolResult)).toBe("ok");
    expect(textOf((await b.callTool({ name: "crm__search", arguments: {} })) as CallToolResult)).toContain("quota all reached");
  });
});

describe("quotas config", () => {
  it("parses with per defaulting to user", () => {
    const config = parseGatewayYaml(
      "version: 1\nupstreams:\n  crm:\n    command: node\nquotas:\n  - match: { label: egress }\n    limit: 100\n    windowSeconds: 3600\n",
    );
    expect(config.quotas).toEqual([{ match: { label: "egress" }, limit: 100, windowSeconds: 3600, per: "user" }]);
  });

  it("rejects a zero limit", () => {
    expect(() =>
      parseGatewayYaml("version: 1\nupstreams:\n  crm:\n    command: node\nquotas:\n  - limit: 0\n    windowSeconds: 60\n"),
    ).toThrow(/limit/);
  });
});
