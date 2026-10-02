import { describe, expect, it, vi } from "vitest";
import { PolicySync } from "../gateway/policy-sync.js";
import { parseGatewayYaml } from "../gateway/config.js";
import { gatewayConfig } from "./fakes.js";

const dashboard = { url: "https://dash.test/api/v1/gateway/events", apiKey: "gb_key", source: "laptop" };

type Reply = { status: number; body?: unknown; etag?: string } | "offline";

function fakeDashboard(replies: Reply[]) {
  const requests: { url: string; auth: string | null; ifNoneMatch: string | null }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(url), auth: headers.get("authorization"), ifNoneMatch: headers.get("if-none-match") });
    const reply = replies.shift() ?? { status: 304 };
    if (reply === "offline") throw new Error("ECONNREFUSED");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.etag ? { etag: reply.etag } : {},
    });
  });
  return { impl: impl as unknown as typeof fetch, requests };
}

const remotePolicy = {
  rules: [{ id: "no-deletes", match: { tool: "*__delete_*" }, action: "deny" }],
  taint: { mode: "approve" },
  labels: { web__fetch: ["untrusted"] },
};

function setup(replies: Reply[]) {
  const config = gatewayConfig({ rules: [{ id: "local", match: {}, action: "warn" }], audit: { enabled: false, sink: "console", dashboard } });
  const { impl, requests } = fakeDashboard(replies);
  const log: string[] = [];
  const sync = new PolicySync(config, dashboard, 60, impl, (m) => log.push(m));
  return { config, sync, requests, log };
}

describe("PolicySync", () => {
  it("applies the dashboard policy and sends the key to the policy endpoint", async () => {
    const { config, sync, requests } = setup([{ status: 200, body: { data: { version: 3, policy: remotePolicy } }, etag: '"v3"' }]);
    expect(await sync.refresh()).toBe("updated");
    expect(requests[0]).toMatchObject({ url: "https://dash.test/api/v1/gateway/policy", auth: "Bearer gb_key" });
    expect(config.rules).toEqual(remotePolicy.rules);
    expect(config.taint).toEqual({ mode: "approve" });
    expect(config.labels).toEqual({ web__fetch: ["untrusted"] });
    expect(config.defaults).toEqual({ action: "allow" });
    expect(sync.version).toBe(3);
  });

  it("revalidates with the ETag and keeps the policy on 304", async () => {
    const { config, sync, requests } = setup([
      { status: 200, body: { data: { version: 3, policy: remotePolicy } }, etag: '"v3"' },
      { status: 304 },
    ]);
    await sync.refresh();
    expect(await sync.refresh()).toBe("unchanged");
    expect(requests[1]?.ifNoneMatch).toBe('"v3"');
    expect(config.rules).toEqual(remotePolicy.rules);
  });

  it.each([
    ["no policy saved yet (404)", { status: 404 }, "none"],
    ["the dashboard is offline", "offline" as const, "unreachable"],
    ["the dashboard errors", { status: 500 }, "unreachable"],
    ["the policy is invalid", { status: 200, body: { data: { version: 4, policy: { rules: [{ match: {}, action: "explode" }] } } } }, "invalid"],
  ] as const)("keeps the local policy when %s", async (_, reply, result) => {
    const { config, sync, log } = setup([reply as Reply]);
    expect(await sync.refresh()).toBe(result);
    expect(config.rules).toEqual([{ id: "local", match: {}, action: "warn" }]);
    expect(log.length).toBeGreaterThan(0);
  });

  it("keeps the last good dashboard policy when a later one is invalid", async () => {
    const { config, sync } = setup([
      { status: 200, body: { data: { version: 3, policy: remotePolicy } }, etag: '"v3"' },
      { status: 200, body: { data: { version: 4, policy: { taint: { mode: "yolo" } } } }, etag: '"v4"' },
    ]);
    await sync.refresh();
    expect(await sync.refresh()).toBe("invalid");
    expect(config.taint).toEqual({ mode: "approve" });
  });

  it("rejects a dashboard approval channel this proxy cannot use", async () => {
    const config = gatewayConfig({ audit: { enabled: false, sink: "console" } });
    const { impl } = fakeDashboard([{ status: 200, body: { data: { version: 1, policy: { approval: { channels: ["dashboard"] } } } } }]);
    const sync = new PolicySync(config, dashboard, 60, impl, () => {});
    expect(await sync.refresh()).toBe("invalid");
    expect(config.approval.channels).toEqual(["elicitation"]);
  });
});

describe("policy.source config", () => {
  const base = "version: 1\nupstreams: { a: { command: node } }\n";

  it("defaults to local", () => {
    expect(parseGatewayYaml(base).policy).toEqual({ source: "local" });
  });

  it("needs audit.dashboard to read the policy from the dashboard", () => {
    expect(() => parseGatewayYaml(base + "policy: { source: dashboard }")).toThrow("needs audit.dashboard");
    process.env["TEST_GB_POLICY_KEY"] = "k";
    const cfg = parseGatewayYaml(
      base + "policy: { source: dashboard, refreshSeconds: 30 }\naudit: { dashboard: { url: https://x/api/v1/gateway/events, apiKeyEnv: TEST_GB_POLICY_KEY } }",
    );
    expect(cfg.policy).toEqual({ source: "dashboard", refreshSeconds: 30 });
    delete process.env["TEST_GB_POLICY_KEY"];
  });
});
