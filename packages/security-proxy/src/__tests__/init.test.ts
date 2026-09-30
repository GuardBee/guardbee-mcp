import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { parseGatewayYaml } from "../gateway/config.js";
import { clientConfigPath, planInit, runInit } from "../init.js";

const desktop = {
  globalShortcut: "Ctrl+Space",
  mcpServers: {
    github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "ghp_x" } },
    "my db!": { command: "node", args: ["db.js"] },
    remote: { url: "https://mcp.example.com/mcp" },
    old: { command: "node", args: ["old.js"], disabled: true },
  },
};

describe("planInit", () => {
  const plan = planInit(JSON.stringify(desktop), "/home/u/.guardbee/p.yaml", "/home/u/.guardbee/audit.jsonl");

  it("moves stdio servers into a YAML the proxy accepts", () => {
    expect(plan.migrated).toEqual({ github: "github", "my db!": "my-db" });
    const cfg = parseGatewayYaml(plan.yaml);
    expect(cfg.upstreams["github"]).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_x" },
    });
    expect(cfg.taint.mode).toBe("strict");
    expect(cfg.audit).toMatchObject({ sink: "file", filePath: "/home/u/.guardbee/audit.jsonl" });
  });

  it("keeps HTTP and disabled servers, other settings, and adds the proxy entry", () => {
    const client = JSON.parse(plan.clientConfig);
    expect(client.globalShortcut).toBe("Ctrl+Space");
    expect(Object.keys(client.mcpServers)).toEqual(["remote", "old", "guardbee"]);
    expect(client.mcpServers.guardbee).toEqual({
      command: "npx",
      args: ["-y", "@guardbee/mcp-security-proxy@^1", "--config", "/home/u/.guardbee/p.yaml"],
    });
    expect(plan.kept.map((k) => k.name)).toEqual(["remote", "old"]);
    expect(plan.kept[0]?.reason).toContain("bypasses the policy");
  });

  it("leaves an existing proxy entry alone and refuses when nothing is left to move", () => {
    const proxied = { mcpServers: { guardbee: { command: "npx", args: ["-y", "@guardbee/mcp-security-proxy", "--config", "x"] } } };
    expect(() => planInit(JSON.stringify(proxied), "/p.yaml", "/a.jsonl")).toThrow("No stdio MCP servers");
  });

  it("does not collide with a server already called guardbee", () => {
    const cfg = { mcpServers: { guardbee: { url: "https://x" }, a: { command: "node" } } };
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
