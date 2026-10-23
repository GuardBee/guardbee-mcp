import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { EgressBlockedError } from "@guardbee/guard-core";
import { parseGatewayYaml } from "../gateway/config.js";
import { connectHttpUpstream, upstreamEgressPolicy } from "../gateway/upstream.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A stateless Streamable HTTP MCP server on 127.0.0.1 with one tool. */
async function localServer(): Promise<string> {
  const server = http.createServer(async (req, res) => {
    const mcp = new Server({ name: "local", version: "0.0.0" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "ping", inputSchema: { type: "object" as const } }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    await mcp.connect(transport);
    await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

describe("upstreamEgressPolicy", () => {
  const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("lets a server configured on the private network stay there", async () => {
    expect((await upstreamEgressPolicy({ url: "http://127.0.0.1:3000/mcp" })).blockPrivate).toBe(false);
    expect((await upstreamEgressPolicy({ url: "http://localhost:3000/mcp" })).blockPrivate).toBe(false);
    expect((await upstreamEgressPolicy({ url: "http://mcp.corp/mcp" }, resolvesTo("10.0.0.7"))).blockPrivate).toBe(false);
  });

  it("keeps a public server off the private network", async () => {
    expect((await upstreamEgressPolicy({ url: "https://mcp.example.com/mcp" }, resolvesTo("93.184.216.34"))).blockPrivate).toBe(true);
    expect((await upstreamEgressPolicy({ url: "https://split.example.com/mcp" }, resolvesTo("93.184.216.34", "10.0.0.7"))).blockPrivate).toBe(true);
    expect((await upstreamEgressPolicy({ url: "https://unresolvable.example/mcp" }, async () => Promise.reject(new Error("ENOTFOUND")))).blockPrivate).toBe(true);
  });

  it("takes blockPrivate and the allowlist as configured", async () => {
    const policy = await upstreamEgressPolicy({ url: "http://127.0.0.1:3000/mcp", network: { mode: "allowlist", allowHosts: ["127.0.0.1"], blockPrivate: true } });
    expect(policy).toEqual({ mode: "allowlist", allowHosts: ["127.0.0.1"], blockPrivate: true });
  });
});

describe("HTTP upstream connections", () => {
  it("connect as before to a local server (no network section)", async () => {
    const upstream = await connectHttpUpstream("local", { url: await localServer() });
    cleanups.push(() => upstream.close());
    expect((await upstream.listTools()).map((t) => t.name)).toEqual(["ping"]);
  });

  it("are refused, and reported, when the address is private and blockPrivate is on", async () => {
    const blocked: EgressBlockedError[] = [];
    const url = await localServer();
    await expect(connectHttpUpstream("local", { url, network: { blockPrivate: true } }, { onEgressBlocked: (e) => blocked.push(e) })).rejects.toThrow(/loopback address/);
    expect(blocked[0]).toMatchObject({ rule: "network:private", host: "127.0.0.1", address: "127.0.0.1" });
  });

  it("are refused when the host is not in allowHosts", async () => {
    const blocked: EgressBlockedError[] = [];
    const url = (await localServer()).replace("127.0.0.1", "localhost");
    const network = { mode: "allowlist" as const, allowHosts: ["mcp.example.com"] };
    await expect(connectHttpUpstream("local", { url, network }, { onEgressBlocked: (e) => blocked.push(e) })).rejects.toThrow(/not in allowHosts/);
    expect(blocked.map((e) => e.rule)).toEqual(["network:host"]);
  });
});

describe("network config", () => {
  const base = (upstream: string) => `version: 1\nupstreams:\n  web:\n${upstream}`;

  it("accepts a network section on an HTTP upstream", () => {
    const config = parseGatewayYaml(base(`    url: https://mcp.example.com/mcp\n    network:\n      mode: allowlist\n      allowHosts: ["mcp.example.com", "*.cdn.example.com"]\n`));
    expect(config.upstreams["web"]).toMatchObject({ network: { mode: "allowlist", allowHosts: ["mcp.example.com", "*.cdn.example.com"] } });
  });

  it("refuses one on a stdio upstream, and an allowlist with no hosts", () => {
    expect(() => parseGatewayYaml(base(`    command: node\n    network:\n      blockPrivate: true\n`))).toThrow(/network rules apply to HTTP upstreams/);
    expect(() => parseGatewayYaml(base(`    url: https://mcp.example.com/mcp\n    network:\n      mode: allowlist\n`))).toThrow(/needs at least one host/);
  });
});
