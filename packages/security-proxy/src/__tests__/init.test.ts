import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { parseGatewayYaml } from "../gateway/config.js";
import { clientConfigPath, defaultSandboxRuntime, planInit, runInit } from "../init.js";

const desktop = {
  globalShortcut: "Ctrl+Space",
  mcpServers: {
    github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "ghp_x" } },
    "my db!": { command: "node", args: ["db.js"] },
    remote: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer r" } },
    legacy: { type: "sse", url: "https://sse.example.com/sse" },
    old: { command: "node", args: ["old.js"], disabled: true },
  },
};

describe("planInit", () => {
  const plan = planInit(JSON.stringify(desktop), "/home/u/.guardbee/p.yaml", "/home/u/.guardbee/audit.jsonl");

  it("moves stdio and Streamable HTTP servers into a YAML the proxy accepts", () => {
    expect(plan.migrated).toEqual({ github: "github", "my db!": "my-db", remote: "remote" });
    const cfg = parseGatewayYaml(plan.yaml);
    expect(cfg.upstreams["github"]).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_x" },
    });
    expect(cfg.upstreams["remote"]).toEqual({ url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer r" } });
    expect(cfg.taint.mode).toBe("strict");
    expect(cfg.audit).toMatchObject({ sink: "file", filePath: "/home/u/.guardbee/audit.jsonl" });
  });

  it("keeps SSE and disabled servers, other settings, and adds the proxy entry", () => {
    const client = JSON.parse(plan.clientConfig);
    expect(client.globalShortcut).toBe("Ctrl+Space");
    expect(Object.keys(client.mcpServers)).toEqual(["legacy", "old", "guardbee"]);
    expect(client.mcpServers.guardbee).toEqual({
      command: "npx",
      args: ["-y", "@guardbee/mcp-security-proxy@^1", "--config", "/home/u/.guardbee/p.yaml"],
    });
    expect(plan.kept.map((k) => k.name)).toEqual(["legacy", "old"]);
    expect(plan.kept[0]?.reason).toContain("bypasses the policy");
    expect(plan.kept[0]?.reason).toContain("at /mcp instead of /sse");
  });

  it("leaves an existing proxy entry alone and refuses when nothing is left to move", () => {
    const proxied = { mcpServers: { guardbee: { command: "npx", args: ["-y", "@guardbee/mcp-security-proxy", "--config", "x"] } } };
    expect(() => planInit(JSON.stringify(proxied), "/p.yaml", "/a.jsonl")).toThrow("No MCP servers");
  });

  it("does not collide with a server already called guardbee", () => {
    const cfg = { mcpServers: { guardbee: { type: "sse", url: "https://x" }, a: { command: "node" } } };
    const client = JSON.parse(planInit(JSON.stringify(cfg), "/p.yaml", "/a.jsonl").clientConfig);
    expect(Object.keys(client.mcpServers)).toEqual(["guardbee", "guardbee-gateway"]);
  });
});

describe("runInit", () => {
  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-init-"));
    const client = path.join(dir, "claude_desktop_config.json");
    fs.writeFileSync(client, JSON.stringify(desktop, null, 2));
    return { dir, client, yaml: path.join(dir, "guardbee", "guardbee-proxy.yaml") };
  }

  it("writes the YAML with 0600, backs up and rewrites the client config", () => {
    const { client, yaml } = setup();
    const original = fs.readFileSync(client, "utf8");
    const result = runInit({ clientConfigPath: client, yamlPath: yaml, now: new Date("2026-09-30T12:00:00Z") });

    expect(fs.readFileSync(result.backupPath!, "utf8")).toBe(original);
    expect(result.backupPath).toContain("guardbee-backup-2026-09-30T12-00-00-000Z");
    expect(fs.statSync(yaml).mode & 0o777).toBe(0o600);
    expect(parseYaml(fs.readFileSync(yaml, "utf8")).upstreams.github.command).toBe("npx");
    expect(JSON.parse(fs.readFileSync(client, "utf8")).mcpServers.guardbee.args).toContain(yaml);
  });

  it("dry run touches nothing", () => {
    const { client, yaml } = setup();
    const before = fs.readFileSync(client, "utf8");
    runInit({ clientConfigPath: client, yamlPath: yaml, dryRun: true });
    expect(fs.readFileSync(client, "utf8")).toBe(before);
    expect(fs.existsSync(yaml)).toBe(false);
  });

  it("will not overwrite an existing YAML without force; with force it also tightens the mode", () => {
    const { client, yaml } = setup();
    fs.mkdirSync(path.dirname(yaml), { recursive: true });
    fs.writeFileSync(yaml, "version: 1\n", { mode: 0o644 });
    expect(() => runInit({ clientConfigPath: client, yamlPath: yaml })).toThrow("--force");
    runInit({ clientConfigPath: client, yamlPath: yaml, force: true });
    expect(fs.statSync(yaml).mode & 0o777).toBe(0o600);
  });
});

describe("clientConfigPath", () => {
  it("knows each client's user config location", () => {
    expect(clientConfigPath("claude-desktop", "darwin", "/Users/a")).toBe(
      "/Users/a/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(clientConfigPath("claude-desktop", "linux", "/home/a")).toBe("/home/a/.config/Claude/claude_desktop_config.json");
    expect(clientConfigPath("cursor", "linux", "/home/a")).toBe("/home/a/.cursor/mcp.json");
    expect(clientConfigPath("claude-code", "linux", "/home/a")).toBe("/home/a/.claude.json");
  });
});

describe("init --sandbox", () => {
  it("puts stdio servers in the sandbox, with their directory arguments writable, and leaves containers and HTTP servers alone", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guardbee-init-sandbox-")));
    const cfg = {
      mcpServers: {
        files: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", dir, "/does/not/exist"] },
        github: { command: "docker", args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"] },
        remote: { url: "https://mcp.example.com/mcp" },
      },
    };
    const plan = planInit(JSON.stringify(cfg), path.join(dir, "p.yaml"), path.join(dir, "a.jsonl"), { sandbox: "docker", home: os.homedir() });
    const config = parseGatewayYaml(plan.yaml);
    expect(config.upstreams["files"]).toMatchObject({ sandbox: { runtime: "docker", fs: { readWrite: [dir] }, network: "open" } });
    expect(config.upstreams["github"]).not.toHaveProperty("sandbox");
    expect(config.upstreams["remote"]).not.toHaveProperty("sandbox");
    expect(plan.yaml).toContain("docker sandbox");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("picks the runtime the OS has", () => {
    expect(defaultSandboxRuntime("darwin")).toBe("sandbox-exec");
    expect(defaultSandboxRuntime("win32")).toBe("docker");
    expect(defaultSandboxRuntime("linux", "")).toBe("docker");
  });
});
