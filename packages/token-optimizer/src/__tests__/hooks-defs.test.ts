import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "http";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ClaudePaths } from "@guardbee/mcp-claude-usage-guard";
import { contextHook, lastMainCall, warningLevel } from "../context-hook.js";
import { configuredServers, expandVars, measureDefinitions, readDefinitionCosts, saveDefinitionCosts, type ConfiguredServer } from "../mcp-defs.js";
import { optimizationReport } from "../optimize.js";

function tempClaude(): ClaudePaths & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "guardbee-hooks-"));
  const paths = { root, claudeDir: join(root, ".claude"), claudeJson: join(root, ".claude.json"), stateDir: join(root, ".guardbee", "claude-usage-guard") };
  mkdirSync(paths.claudeDir, { recursive: true });
  return paths;
}

function call(context: number, opts: { sidechain?: boolean } = {}): string {
  return JSON.stringify({ type: "assistant", isSidechain: opts.sidechain ?? false, message: { model: "claude-opus-5-5", usage: { input_tokens: 10, cache_read_input_tokens: context - 10, cache_creation_input_tokens: 0, output_tokens: 50 } } });
}

function transcript(root: string, lines: string[]): string {
  const file = join(root, "t.jsonl");
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

describe("lastMainCall", () => {
  it("takes the latest main-thread call and skips subagents", () => {
    const { root } = tempClaude();
    const file = transcript(root, [call(100_000), JSON.stringify({ type: "user", message: { content: "hi" } }), call(250_000), call(900_000, { sidechain: true })]);
    const last = lastMainCall(file)!;
    expect(last.context).toBe(250_000);
    expect(last.perMessageWeighted).toBeCloseTo(25_000);
  });

  it("reads only the tail of a large transcript", () => {
    const { root } = tempClaude();
    const filler = JSON.stringify({ type: "user", message: { content: "x".repeat(1_000_000) } });
    const file = transcript(root, [call(50_000), filler, filler, filler, filler, filler, call(300_000)]);
    expect(lastMainCall(file)!.context).toBe(300_000);
  });

  it("returns undefined for a missing file", () => {
    expect(lastMainCall("/nope/t.jsonl")).toBeUndefined();
  });
});

describe("contextHook", () => {
  it("steps warnings by threshold", () => {
    expect([150_000, 200_000, 299_999, 300_000, 450_000].map((c) => warningLevel(c))).toEqual([0, 1, 1, 2, 3]);
  });

  it("warns once per level, re-arms after a compact, and speaks Turkish", () => {
    const paths = tempClaude();
    const big = transcript(paths.root, [call(230_000)]);
    const input = { session_id: "s1", transcript_path: big };
    const first = contextHook(input, { paths });
    expect(first?.systemMessage).toMatch(/230k tokens \(threshold 200k\)/);
    expect(contextHook(input, { paths })).toBeUndefined();

    const small = transcript(paths.root, [call(40_000)]);
    expect(contextHook({ session_id: "s1", transcript_path: small }, { paths })).toBeUndefined();
    const again = transcript(paths.root, [call(210_000)]);
    expect(contextHook({ session_id: "s1", transcript_path: again }, { paths, lang: "tr" })?.systemMessage).toMatch(/bağlamı 210k token/);
  });

  it("includes the plan cost per message when calibrated", () => {
    const paths = tempClaude();
    const file = transcript(paths.root, [call(400_000)]);
    const out = contextHook({ session_id: "s2", transcript_path: file }, { paths, planPct: (w) => w / 10_000 });
    expect(out?.systemMessage).toMatch(/~4\.0% of the 5-hour limit per message/);
  });

  it("uses context_tokens on a resume before any new call", () => {
    const paths = tempClaude();
    expect(contextHook({ session_id: "s3", context_tokens: 500_000 }, { paths })?.systemMessage).toMatch(/500k/);
  });

  it("stays quiet without a session or below the threshold", () => {
    const paths = tempClaude();
    expect(contextHook({}, { paths })).toBeUndefined();
    expect(contextHook({ session_id: "s4", transcript_path: transcript(paths.root, [call(10_000)]) }, { paths })).toBeUndefined();
  });
});

describe("expandVars", () => {
  it("expands ${VAR} and ${VAR:-default}", () => {
    expect(expandVars("Bearer ${TOKEN}", { TOKEN: "t" })).toBe("Bearer t");
    expect(expandVars("${MISSING:-dflt}/x/${A}", { A: "a" })).toBe("dflt/x/a");
    expect(expandVars("no vars", {})).toBe("no vars");
  });
});

// A minimal stdio MCP server that pages its tool list
const FAKE_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
const page1 = [{ name: "big", description: "d".repeat(4000), inputSchema: { type: "object" } }];
const page2 = [{ name: "small", description: "s", inputSchema: { type: "object" } }];
console.log("a log line that is not JSON-RPC");
rl.on("line", (l) => {
  const m = JSON.parse(l);
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  if (m.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } });
  if (m.method === "tools/list") reply(m.params && m.params.cursor ? { tools: page2 } : { tools: page1, nextCursor: "p2" });
});
`;

describe("measureDefinitions", () => {
  let http: Server;
  let base = "";
  beforeAll(async () => {
    http = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/locked") {
          res.writeHead(401).end();
          return;
        }
        const m = JSON.parse(body);
        if (m.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        const result = m.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "h", version: "1" } } : { tools: [{ name: "remote", description: "r".repeat(400), inputSchema: {} }] };
        // Answer as an SSE stream, as streamable HTTP servers may
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "sess-1" });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`);
      });
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    const addr = http.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(() => http.close());

  it("measures stdio (with pagination) and http/SSE servers, and reports failures", async () => {
    const { root } = tempClaude();
    const script = join(root, "fake.cjs");
    writeFileSync(script, FAKE_SERVER);
    const servers: ConfiguredServer[] = [
      { name: "stdio", scope: "user", disabled: false, config: { command: process.execPath, args: [script] } },
      { name: "remote", scope: "user", disabled: false, config: { type: "http", url: `${base}/mcp` } },
      { name: "locked", scope: "user", disabled: false, config: { type: "http", url: `${base}/locked` } },
      { name: "missing", scope: "user", disabled: false, config: { command: "definitely-not-a-binary-xyz" } },
    ];
    const costs = Object.fromEntries((await measureDefinitions(servers, 10_000)).map((c) => [c.name, c]));
    expect(costs.stdio).toMatchObject({ ok: true, tools: 2 });
    expect(costs.stdio.tokens).toBeGreaterThan(1000);
    expect(costs.stdio.largest[0].name).toBe("big");
    expect(costs.remote).toMatchObject({ ok: true, tools: 1 });
    expect(costs.locked.ok).toBe(false);
    expect(costs.locked.error).toMatch(/401/);
    expect(costs.missing.ok).toBe(false);
  }, 30_000);

  it("finds configured servers in every scope, including flat plugin .mcp.json files", () => {
    const paths = tempClaude();
    const project = join(paths.root, "proj");
    const plugin = join(paths.root, "plugin");
    mkdirSync(project);
    mkdirSync(plugin);
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db" } } }));
    writeFileSync(join(plugin, ".mcp.json"), JSON.stringify({ gh: { type: "http", url: "https://x" } }));
    mkdirSync(join(paths.claudeDir, "plugins"));
    writeFileSync(join(paths.claudeDir, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "p@m": [{ installPath: plugin }] } }));
    writeFileSync(join(paths.claudeDir, "settings.json"), JSON.stringify({ enabledPlugins: { "p@m": true } }));
    writeFileSync(paths.claudeJson, JSON.stringify({ mcpServers: { u: { command: "u" } }, projects: { [project]: { mcpServers: { l: { command: "l" } }, disabledMcpjsonServers: ["db"] } } }));
    const servers = configuredServers({ paths });
    expect(servers.map((s) => `${s.scope}:${s.name}:${s.disabled}`).sort()).toEqual(["local:l:false", "plugin:p@m/gh:false", "project:db:true", "user:u:false"]);
    expect(servers.find((s) => s.scope === "plugin")?.pluginRoot).toBe(plugin);
  });

  it("feeds stored measurements into the optimization report", () => {
    const paths = tempClaude();
    writeFileSync(paths.claudeJson, "{}");
    saveDefinitionCosts([{ name: "heavy", scope: "user", ok: true, tools: 40, chars: 120_000, tokens: 30_000, largest: [{ name: "q", tokens: 3000 }], measuredAt: Date.now() }], paths);
    expect(readDefinitionCosts(paths)).toHaveLength(1);
    const recs = optimizationReport({ paths, sessions: [], mcpServers: [{ name: "heavy", scope: "user", disabled: false, toggleable: true, calls: 0, resultChars: 0 }] });
    const rec = recs.find((r) => r.title.includes("heavy defines"));
    expect(rec).toMatchObject({ impact: "high" });
    expect(rec?.title).toMatch(/30k tokens of tools and was not used/);
  });
});
