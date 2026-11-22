import { describe, expect, it } from "vitest";
import { defaultHostConfigPaths, parseCodexToml, parseHostConfig } from "../discover.js";

describe("defaultHostConfigPaths", () => {
  it("covers the newer coding agents on every OS", () => {
    for (const os of ["darwin", "linux", "win32"] as const) {
      const clients = defaultHostConfigPaths("/home/u", os).map((p) => p.client);
      expect(clients).toEqual(expect.arrayContaining(["codex", "kiro", "copilot-cli", "amazon-q", "lm-studio", "roo-code", "opencode"]));
    }
  });
});

describe("parseCodexToml", () => {
  it("reads [mcp_servers.<name>] tables, env sub-tables and multi-line arrays", () => {
    const servers = parseCodexToml(`
model = "gpt-5"   # not an MCP table

[mcp_servers.github]
command = "npx"
args = [
  "-y",
  "@modelcontextprotocol/server-github@1.2.0", # pinned
]
env = { GITHUB_TOKEN = "ghp_x", "MODE" = 'read' }

[mcp_servers."docs.remote"]
url = "https://mcp.example.com/mcp"
http_headers = { Authorization = "Bearer t" }
enabled = false

[mcp_servers.github.env]
EXTRA = "1"

[profiles.fast]
command = "ignored"
`);
    expect(servers).toHaveLength(2);
    const github = servers.find((s) => s.name === "github")!;
    expect(github.command).toBe("npx");
    expect(github.args).toEqual(["-y", "@modelcontextprotocol/server-github@1.2.0"]);
    expect(github.env).toEqual({ GITHUB_TOKEN: "ghp_x", MODE: "read", EXTRA: "1" });
    const remote = servers.find((s) => s.name === "docs.remote")!;
    expect(remote.url).toBe("https://mcp.example.com/mcp");
    expect(remote.headers).toEqual({ Authorization: "Bearer t" });
    expect(remote.disabled).toBe(true);
  });

  it("treats a Codex config without MCP servers as normal", () => {
    expect(parseHostConfig("codex", 'model = "o4"\n')).toEqual({ groups: [{ client: "codex", servers: [] }] });
  });
});

describe("opencode", () => {
  it("reads local and remote entries from the mcp key", () => {
    const { groups } = parseHostConfig(
      "opencode",
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          fs: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"], environment: { A: "1" } },
          remote: { type: "remote", url: "https://mcp.example.com/mcp", headers: { "x-key": "k" }, enabled: false },
        },
      })
    );
    const [fs, remote] = groups[0]!.servers;
    expect(fs).toMatchObject({ name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], env: { A: "1" } });
    expect(remote).toMatchObject({ name: "remote", url: "https://mcp.example.com/mcp", headers: { "x-key": "k" }, disabled: true });
  });
});
