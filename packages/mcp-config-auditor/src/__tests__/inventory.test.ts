import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultHostConfigPaths, discoverShadowMcp, parseHostConfig, stripJsonc } from "../discover.js";
import { buildInventory, redactArgs, sanitizeUrl, uploadInventory } from "../inventory.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gb-inv-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Built in pieces so the repo's secret scanner does not take the fixture for a real credential. */
const CONN = ["postgres://app", "pw@db/prod"].join(":");

const write = (path: string, value: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
};

describe("host configs", () => {
  it("reads Claude Code user and per-project servers", () => {
    const text = JSON.stringify({
      numStartups: 3,
      mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } },
      projects: { "/work/app": { mcpServers: { db: { command: "uvx", args: ["mcp-server-postgres==0.6.2"] } } }, "/work/empty": { allowedTools: [] } },
    });
    const parsed = parseHostConfig("claude-code", text);
    expect(parsed.groups.map((g) => [g.client, g.servers.map((s) => s.name)])).toEqual([
      ["claude-code", ["github"]],
      ["claude-code:/work/app", ["db"]],
    ]);
    // A settings file without MCP servers is normal, not an error
    expect(parseHostConfig("claude-code", JSON.stringify({ numStartups: 1 }))).toEqual({ groups: [] });
    expect(parseHostConfig("cursor", JSON.stringify({ x: 1 })).error).toBeDefined();
  });

  it("reads Zed context_servers from JSON with comments", () => {
    const zed = `{
      // theme
      "theme": "One Dark", /* trailing comma below */
      "context_servers": {
        "postgres": { "command": { "path": "npx", "args": ["-y", "mcp-postgres"], "env": { "PGPASSWORD": "x" } } },
        "remote": { "url": "https://mcp.acme.com/sse", },
      },
    }`;
    const parsed = parseHostConfig("zed", zed);
    expect(parsed.groups[0]!.servers.map((s) => [s.name, s.command ?? s.url, Object.keys(s.env)])).toEqual([
      ["postgres", "npx", ["PGPASSWORD"]],
      ["remote", "https://mcp.acme.com/sse", []],
    ]);
    expect(stripJsonc('{"url": "https://x//y", "a": "/* not a comment */"}')).toBe('{"url": "https://x//y", "a": "/* not a comment */"}');
  });

  it("knows Gemini CLI, Cline and Zed paths", () => {
    const clients = defaultHostConfigPaths("/h", "darwin").map((p) => p.client);
    expect(clients).toEqual(expect.arrayContaining(["gemini-cli", "cline", "zed", "claude-code", "cursor", "windsurf", "vscode"]));
  });
});

describe("inventory", () => {
  it("redacts secrets in args and URLs", () => {
    expect(redactArgs(["--api-key", "abc123", "--port", "8080", "--token=xyz", "ghp_1234567890abcdefghijklmnop", CONN, "API_TOKEN=s3cret"])).toEqual([
      "--api-key",
      "[redacted]",
      "--port",
      "8080",
      "--token=[redacted]",
      "[redacted]",
      ["postgres://app", "[redacted]@db/prod"].join(":"),
      "API_TOKEN=[redacted]",
    ]);
    expect(sanitizeUrl(`https://user:${"pa" + "ss"}@mcp.acme.com/sse?token=abc&team=x#frag`)).toBe("https://mcp.acme.com/sse?token=%E2%80%A6&team=%E2%80%A6");
  });

  it("lists every server with names of env keys only, and its findings", () => {
    write(join(home, ".cursor", "mcp.json"), {
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@1.2.3"], env: { GITHUB_TOKEN: "ghp_realvalue1234567890abcdef" } },
        remote: { url: "https://mcp.acme.com/mcp?key=secret", headers: { Authorization: "Bearer zzz" } },
      },
    });
    write(join(home, ".claude.json"), { projects: { "/work/app": { mcpServers: { github: { command: "npx", args: ["-y", "@acme-forks/server-github"] } } } } });
    const result = discoverShadowMcp({ home, paths: defaultHostConfigPaths(home, "linux") });
    const inventory = buildInventory(result, { includeUser: false, now: new Date("2026-10-14T00:00:00Z") });
    expect(inventory.summary).toEqual({ configs: 2, servers: 3, shadow: 0, unreviewed: 3 });
    const github = inventory.servers.find((s) => s.client === "cursor" && s.name === "github")!;
    expect(github).toMatchObject({ transport: "stdio", package: { name: "@modelcontextprotocol/server-github", version: "1.2.3", pinned: true }, envKeys: ["GITHUB_TOKEN"], findings: ["unreviewed_mcp_server", "mcp_server_drift_across_clients"] });
    expect(inventory.servers.find((s) => s.name === "remote")).toMatchObject({ transport: "http", url: "https://mcp.acme.com/mcp?key=%E2%80%A6", headerKeys: ["Authorization"] });
    expect(inventory.servers.find((s) => s.client === "claude-code:/work/app")!.package).toMatchObject({ pinned: false });
    const json = JSON.stringify(inventory);
    expect(json).not.toContain("realvalue");
    expect(json).not.toContain("zzz");
    expect(json).not.toContain("secret");
    expect(inventory.source.user).toBeUndefined();
    // The same name pointing at a different package in another client is drift
    expect(result.findings.some((f) => f.patternId === "mcp_server_drift_across_clients" && f.server === "github")).toBe(true);
  });

  it("uploads with the API key and reports failures", async () => {
    const seen: { url: string; auth: string; body: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: String(init.body) });
      return new Response(seen.length === 1 ? '{"data":{"received":1}}' : '{"error":"forbidden"}', { status: seen.length === 1 ? 200 : 403 });
    }) as unknown as typeof fetch;
    const report = buildInventory({ scannedFiles: 0, missingPaths: 0, findings: [], durationMs: 0, discovered: [] }, { includeUser: false });
    expect(await uploadInventory(report, { apiKey: "gb_k", fetchImpl: fake })).toMatchObject({ ok: true, status: 200 });
    expect(seen[0]).toMatchObject({ url: "https://app.guardbee.ai/api/v1/mcp/inventory", auth: "Bearer gb_k" });
    expect(JSON.parse(seen[0]!.body).schema).toBe("guardbee.mcp-inventory/1");
    expect(await uploadInventory(report, { apiKey: "gb_k", fetchImpl: fake })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("CLI discover", () => {
  const bin = join(__dirname, "..", "..", "dist", "cli.js");
  it.runIf(require("fs").existsSync(bin))("prints the inventory as JSON", () => {
    write(join(home, ".gemini", "settings.json"), { theme: "x", mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2025.1.1", "/tmp"] } } });
    const out = execFileSync(process.execPath, [bin, "discover", `--home=${home}`, "--format=json", "--fail-on=none", "--no-user"], { env: { ...process.env, GUARDBEE_TELEMETRY: "0" } }).toString();
    const parsed = JSON.parse(out) as { inventory: { servers: { client: string; name: string }[] } };
    expect(parsed.inventory.servers).toMatchObject([{ client: "gemini-cli", name: "fs" }]);
  });
});
