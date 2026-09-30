import { afterEach, describe, expect, it } from "vitest";
import { parseGatewayYaml } from "../gateway/config.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("HTTP upstreams", () => {
  it("parses url and interpolates headers", () => {
    process.env["TEST_REMOTE_TOKEN"] = "tok_123";
    const cfg = parseGatewayYaml(`
version: 1
upstreams:
  remote:
    url: https://mcp.example.com/mcp
    headers: { Authorization: "Bearer \${TEST_REMOTE_TOKEN}" }
`);
    expect(cfg.upstreams["remote"]).toEqual({ url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer tok_123" } });
  });

  it.each([
    ["no url or command", "upstreams: { a: { headers: { x: y } } }", "needs a url"],
    ["a non-http url", "upstreams: { a: { url: ftp://x } }", "http:// or https://"],
  ])("rejects %s", (_, upstreams, message) => {
    expect(() => parseGatewayYaml(`version: 1\n${upstreams}`)).toThrow(message);
  });
});

describe("listen", () => {
  const base = "version: 1\nupstreams: { a: { command: node } }\n";

  it("defaults to stdio", () => {
    expect(parseGatewayYaml(base).listen).toEqual({ transport: "stdio" });
  });

  it("allows HTTP on loopback without a key", () => {
    const cfg = parseGatewayYaml(base + "listen: { transport: http, port: 9000 }");
    expect(cfg.listen).toEqual({ transport: "http", host: "127.0.0.1", port: 9000, path: "/mcp", apiKeys: [], maxSessions: 100 });
  });

  it("refuses to listen on the network without an API key", () => {
    expect(() => parseGatewayYaml(base + "listen: { transport: http, host: 0.0.0.0 }")).toThrow("needs at least one API key");
  });

  it("reads API keys from the environment", () => {
    process.env["TEST_PROXY_KEY"] = "k_live_1";
    const cfg = parseGatewayYaml(base + 'listen: { transport: http, host: 0.0.0.0, apiKeys: ["${TEST_PROXY_KEY}"] }');
    expect(cfg.listen).toMatchObject({ host: "0.0.0.0", apiKeys: ["k_live_1"] });
  });
});

describe("audit.dashboard", () => {
  const base = "version: 1\nupstreams: { a: { command: node } }\n";

  it("resolves the key from apiKeyEnv and fills defaults", () => {
    process.env["TEST_GB_KEY"] = "gb_key";
    const cfg = parseGatewayYaml(base + "audit: { dashboard: { url: https://app.guardbee.ai/api/v1/gateway/events, apiKeyEnv: TEST_GB_KEY, source: laptop } }");
    expect(cfg.audit.dashboard).toEqual({
      url: "https://app.guardbee.ai/api/v1/gateway/events",
      apiKey: "gb_key",
      source: "laptop",
      batchSize: 100,
      flushIntervalMs: 5000,
    });
  });

  it("fails when the key variable is not set", () => {
    delete process.env["TEST_GB_KEY"];
    expect(() =>
      parseGatewayYaml(base + "audit: { dashboard: { url: https://x/events, apiKeyEnv: TEST_GB_KEY } }"),
    ).toThrow("TEST_GB_KEY");
  });

  it("does not accept the key itself in the file", () => {
    expect(() => parseGatewayYaml(base + "audit: { dashboard: { url: https://x/events, apiKey: gb_key } }")).toThrow();
  });
});
