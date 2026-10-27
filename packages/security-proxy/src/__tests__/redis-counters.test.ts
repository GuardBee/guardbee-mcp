import { execFileSync } from "node:child_process";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../audit/logger.js";
import { parseGatewayYaml } from "../gateway/config.js";
import { Gateway } from "../gateway/gateway.js";
import { QuotaStore, type QuotaRule } from "../gateway/quota.js";
import { BudgetStore } from "../llm/budget.js";
import { MemoryCounters, RedisCounters, ResilientCounters, type CounterBackend } from "../state/counters.js";
import { RedisClient } from "../state/redis.js";
import { fakeUpstream, gatewayConfig } from "./fakes.js";

const dockerUp = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
})();

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe("state config", () => {
  it("needs a url for redis and reads the password from the environment", () => {
    expect(() => parseGatewayYaml("version: 1\nupstreams:\n  a: { command: node }\nstate:\n  backend: redis\n")).toThrow(/needs a url/);
    process.env["TEST_REDIS_PASSWORD"] = "pw";
    const config = parseGatewayYaml("version: 1\nupstreams:\n  a: { command: node }\nstate:\n  backend: redis\n  url: redis://:${TEST_REDIS_PASSWORD}@redis:6379/1\n");
    expect(config.state).toEqual({ backend: "redis", url: "redis://:pw@redis:6379/1", keyPrefix: "guardbee", onError: "local", timeoutMs: 250 });
    delete process.env["TEST_REDIS_PASSWORD"];
  });

  it("keeps the counters in the process by default", () => {
    expect(parseGatewayYaml("version: 1\nupstreams:\n  a: { command: node }\n").state).toBeUndefined();
  });
});

describe("when the shared counters are down", () => {
  const rules: QuotaRule[] = [{ id: "cap", match: {}, limit: 1, windowSeconds: 60, per: "gateway" }];
  const caller = { tool: "t", upstream: "u", labels: [] };
  async function down(onError: "local" | "fail-open" | "fail-closed") {
    const outages: unknown[] = [];
    const client = new RedisClient(`redis://127.0.0.1:${await closedPort()}`, { timeoutMs: 200 });
    const counters = new ResilientCounters(new RedisCounters(client), onError, { onOutage: (err) => outages.push(err) });
    return { store: new QuotaStore(Date.now, counters), outages };
  }

  it("local: counts in this process meanwhile, and says so once", async () => {
    const { store, outages } = await down("local");
    expect(await store.take(rules, caller)).toBeNull();
    expect((await store.take(rules, caller))?.ruleId).toBe("cap");
    expect(outages).toHaveLength(1);
  });

  it("fail-open: lets calls through uncounted", async () => {
    const { store } = await down("fail-open");
    expect(await store.take(rules, caller)).toBeNull();
    expect(await store.take(rules, caller)).toBeNull();
  });

  it("fail-closed: refuses calls that have a quota", async () => {
    const { store } = await down("fail-closed");
    expect(await store.take(rules, caller)).toMatchObject({ ruleId: "state:unavailable", reason: expect.stringMatching(/fail-closed/) });
  });
});

describe.runIf(dockerUp)("Redis (docker)", () => {
  let container = "";
  let url = "";
  const clients: RedisClient[] = [];
  beforeAll(async () => {
    container = execFileSync("docker", ["run", "-d", "--rm", "-p", "127.0.0.1::6379", "redis:7-alpine", "redis-server", "--requirepass", "s3cret"], { encoding: "utf8" }).trim();
    const port = execFileSync("docker", ["port", container, "6379/tcp"], { encoding: "utf8" }).trim().split(":").pop();
    url = `redis://:s3cret@127.0.0.1:${port}/2`;
    // Wait until it answers
    for (let i = 0; i < 50; i++) {
      try {
        const probe = new RedisClient(url, { timeoutMs: 500 });
        await probe.command("PING");
        await probe.close();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw new Error("redis did not start");
  }, 120_000);
  afterAll(async () => {
    await Promise.allSettled(clients.map((c) => c.close()));
    if (container) execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  });

  /** One proxy replica's counters: its own connection, the same Redis. */
  const replica = (prefix: string): CounterBackend => {
    const client = new RedisClient(url, { timeoutMs: 2000 });
    clients.push(client);
    return new RedisCounters(client, prefix);
  };

  it("speaks RESP: auth, database, strings, integers, arrays, errors", async () => {
    const client = new RedisClient(url);
    clients.push(client);
    expect(await client.command("SET", "k", "värde")).toBe("OK");
    expect(await client.command("GET", "k")).toBe("värde");
    expect(await client.command("INCR", "n")).toBe(1);
    expect(await client.command("EVAL", "return {1, 'a', {2}}", 0)).toEqual([1, "a", [2]]);
    await expect(client.command("INCR", "k")).rejects.toThrow(/not an integer/);
    expect(await client.command("GET", "missing")).toBeNull();
    await expect(new RedisClient(url.replace("s3cret", "wrong")).command("PING")).rejects.toThrow(/WRONGPASS|invalid/i);
  });

  it("two replicas enforce one combined quota, through the gateway", async () => {
    const rules: QuotaRule[] = [{ id: "search-cap", match: { tool: "crm__search" }, limit: 3, windowSeconds: 60, per: "gateway" }];
    const crm = fakeUpstream("crm", [{ name: "search" }]);
    const config = gatewayConfig({ quotas: rules });
    const logger = new AuditLogger({ enabled: false, sink: "console" });
    vi.spyOn(logger, "log").mockImplementation(() => {});
    const prefix = `t${Date.now()}`;
    const a = new Gateway([crm], config, logger, undefined, { sessionId: "a", quotas: new QuotaStore(Date.now, replica(prefix)) });
    const b = new Gateway([crm], config, logger, undefined, { sessionId: "b", quotas: new QuotaStore(Date.now, replica(prefix)) });
    const results = [await a.callTool("crm__search", {}), await b.callTool("crm__search", {}), await a.callTool("crm__search", {}), await b.callTool("crm__search", {}), await a.callTool("crm__search", {})];
    expect(results.map((r) => r.isError === true)).toEqual([false, false, false, true, true]);
  });

  it("admits exactly the limit when replicas race", async () => {
    const prefix = `race${Date.now()}`;
    const stores = [new QuotaStore(Date.now, replica(prefix)), new QuotaStore(Date.now, replica(prefix)), new QuotaStore(Date.now, replica(prefix))];
    const rules: QuotaRule[] = [{ id: "cap", match: {}, limit: 10, windowSeconds: 60, per: "gateway" }];
    const outcomes = await Promise.all(Array.from({ length: 30 }, (_, i) => stores[i % 3]!.take(rules, { tool: "t", upstream: "u", labels: [] })));
    expect(outcomes.filter((o) => o === null)).toHaveLength(10);
  });

  it("keeps LLM budgets consistent across replicas: tokens and cost recorded on one count on the other", async () => {
    const prefix = `budget${Date.now()}`;
    const a = new BudgetStore(Date.now, replica(prefix));
    const b = new BudgetStore(Date.now, replica(prefix));
    const budgets = [
      { id: "tokens", match: { model: "gpt-*" }, per: "gateway" as const, windowSeconds: 60, tokens: 100 },
      { id: "spend", match: {}, per: "user" as const, windowSeconds: 3600, costUsd: 0.5 },
    ];
    const caller = { model: "gpt-4o", user: "ayse", groups: [], anonymousId: "k" };
    expect(await a.admit(budgets, caller)).toBeNull();
    await a.record(budgets, caller, { inputTokens: 80, outputTokens: 30 }, 0.2);
    expect((await b.admit(budgets, caller))?.reason).toMatch(/tokens per 60s/);
    // Another model: the token budget does not match, the spend budget (0.2 of 0.5) has room
    expect(await b.admit(budgets, { ...caller, model: "claude-x" })).toBeNull();
    await b.record(budgets, { ...caller, model: "claude-x" }, { inputTokens: 1, outputTokens: 1 }, 0.35);
    expect((await a.admit(budgets, { ...caller, model: "claude-x" }))?.reason).toMatch(/\$0.5 per 3600s for user "ayse"/);
  });

  it("lets keys expire with their window", async () => {
    const client = new RedisClient(url);
    clients.push(client);
    const counters = new RedisCounters(client, `ttl${Date.now()}`);
    await counters.take([{ key: "w", limit: 5, ttlMs: 1500 }]);
    const ttl = Number(await client.command("PTTL", `{${(counters as unknown as { prefix: string }).prefix}}:w`));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1500);
  });
});

describe("memory counters", () => {
  it("are the default and behave like the shared ones", async () => {
    const counters = new MemoryCounters();
    expect(await counters.take([{ key: "a", limit: 1, ttlMs: 60_000 }, { key: "b", limit: 5, ttlMs: 60_000 }])).toBe(-1);
    expect(await counters.take([{ key: "a", limit: 1, ttlMs: 60_000 }, { key: "b", limit: 5, ttlMs: 60_000 }])).toBe(0);
    // Nothing was counted in b by the refused call
    expect(await counters.take([{ key: "b", limit: 2, ttlMs: 60_000 }])).toBe(-1);
    expect(await counters.take([{ key: "b", limit: 2, ttlMs: 60_000 }])).toBe(0);
  });
});
