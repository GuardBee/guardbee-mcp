import { describe, expect, it } from "vitest";
import { scanConfigText } from "../scanner.js";

// #309: a server added next to the gateway (after `guardbee-proxy init`) bypasses its policy
const proxy = { command: "npx", args: ["-y", "@guardbee/mcp-security-proxy@^1", "--config", "/home/a/.guardbee/guardbee-proxy.yaml"] };
const bypass = (servers: Record<string, unknown>) =>
  scanConfigText(JSON.stringify({ mcpServers: servers })).filter((f) => f.patternId === "proxy_bypass");

describe("proxy_bypass", () => {
  it("flags a stdio and a remote server that run next to the gateway", () => {
    const found = bypass({
      guardbee: proxy,
      github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"] },
      legacy: { type: "sse", url: "https://mcp.example.com/sse", headers: { Authorization: "Bearer x" } },
    });
    expect(found.map((f) => f.server).sort()).toEqual(["github", "legacy"]);
    expect(found[0]).toMatchObject({ severity: "high", owasp: "MCP09:2025" });
  });

  it("is quiet when every server is behind the gateway, or a direct one is disabled", () => {
    expect(bypass({ guardbee: proxy })).toEqual([]);
    expect(bypass({ guardbee: proxy, old: { command: "npx", args: ["-y", "x@1.0.0"], disabled: true } })).toEqual([]);
  });

  it("is quiet without the gateway: plain configs are not a bypass", () => {
    expect(bypass({ github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"] } })).toEqual([]);
  });

  it("recognizes the gateway as a global install and as the container image", () => {
    expect(bypass({ gw: { command: "guardbee-proxy", args: ["--config", "p.yaml"] }, fs: { command: "node", args: ["fs.js"] } })).toHaveLength(1);
    expect(bypass({ gw: { command: "docker", args: ["run", "-i", "--rm", "ghcr.io/guardbee/mcp-security-proxy:1"] }, fs: { command: "node", args: ["fs.js"] } })).toHaveLength(1);
  });
});
