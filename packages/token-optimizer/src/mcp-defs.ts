import { spawn } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { compact, resolvePaths, type ClaudePaths } from "@guardbee/mcp-claude-usage-guard";
import { pluginInstallPaths, type McpScope } from "./mcp.js";

export interface ServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface ConfiguredServer {
  name: string;
  scope: Exclude<McpScope, "external">;
  project?: string;
  disabled: boolean;
  config: ServerConfig;
  /** Directory a plugin was installed to, for ${CLAUDE_PLUGIN_ROOT} */
  pluginRoot?: string;
}

export interface DefinitionCost {
  name: string;
  scope: ConfiguredServer["scope"];
  project?: string;
  ok: boolean;
  error?: string;
  tools: number;
  /** Characters of tool names, descriptions and input schemas */
  chars: number;
  /** ≈ chars / 4 */
  tokens: number;
  /** Largest tools by definition size */
  largest: Array<{ name: string; tokens: number }>;
  measuredAt: number;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** A plugin's .mcp.json may wrap its servers in "mcpServers" or list them at the top level. */
function serversOf(json: Record<string, unknown> | undefined): Record<string, ServerConfig> {
  if (!json) return {};
  const inner = json.mcpServers;
  return (inner && typeof inner === "object" ? inner : json) as Record<string, ServerConfig>;
}

/** Every MCP server definition Claude Code would load, with its config. */
export function configuredServers(options: { paths?: Partial<ClaudePaths>; project?: string } = {}): ConfiguredServer[] {
  const paths = resolvePaths(options.paths);
  const config = readJson(paths.claudeJson) ?? {};
  const settings = readJson(join(paths.claudeDir, "settings.json")) ?? {};
  const projects = (config.projects ?? {}) as Record<string, Record<string, unknown>>;
  const out: ConfiguredServer[] = [];

  for (const [name, c] of Object.entries(serversOf({ mcpServers: config.mcpServers ?? {} }))) out.push({ name, scope: "user", disabled: false, config: c });
  for (const dir of options.project ? [options.project] : Object.keys(projects)) {
    const p = projects[dir] ?? {};
    const disabledLocal = new Set(Array.isArray(p.disabledMcpServers) ? p.disabledMcpServers.map(String) : []);
    for (const [name, c] of Object.entries(serversOf({ mcpServers: p.mcpServers ?? {} }))) out.push({ name, scope: "local", project: dir, disabled: disabledLocal.has(name), config: c });
    const disabledProject = new Set(Array.isArray(p.disabledMcpjsonServers) ? p.disabledMcpjsonServers.map(String) : []);
    const mcpJson = readJson(join(dir, ".mcp.json"));
    if (mcpJson) for (const [name, c] of Object.entries(serversOf({ mcpServers: mcpJson.mcpServers ?? {} }))) out.push({ name, scope: "project", project: dir, disabled: disabledProject.has(name), config: c });
  }
  for (const [id, enabled] of Object.entries((settings.enabledPlugins ?? {}) as Record<string, boolean>)) {
    for (const root of pluginInstallPaths(paths, id)) {
      const fromFile = serversOf(readJson(join(root, ".mcp.json")));
      const fromManifest = (readJson(join(root, ".claude-plugin", "plugin.json"))?.mcpServers ?? {}) as Record<string, ServerConfig>;
      for (const [name, c] of Object.entries({ ...fromFile, ...(typeof fromManifest === "object" ? fromManifest : {}) })) {
        out.push({ name: `${id}/${name}`, scope: "plugin", disabled: enabled === false, config: c, pluginRoot: root });
      }
    }
  }
  return out;
}

/** Claude Code expands ${VAR} and ${VAR:-default} in MCP configs; so does the measurement. */
export function expandVars(value: string, env: Record<string, string | undefined>): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf("${", i);
    if (start === -1) break;
    const end = value.indexOf("}", start + 2);
    if (end === -1) break;
    out += value.slice(i, start);
    const expr = value.slice(start + 2, end);
    const sep = expr.indexOf(":-");
    const name = sep === -1 ? expr : expr.slice(0, sep);
    const fallback = sep === -1 ? "" : expr.slice(sep + 2);
    out += env[name] ?? fallback;
    i = end + 1;
  }
  return out + value.slice(i);
}

interface Tool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function cost(server: ConfiguredServer, tools: Tool[]): DefinitionCost {
  const sizes = tools.map((t) => ({ name: t.name, chars: JSON.stringify({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema ?? {} }).length }));
  const chars = sizes.reduce((s, t) => s + t.chars, 0);
  return {
    name: server.name,
    scope: server.scope,
    project: server.project,
    ok: true,
    tools: tools.length,
    chars,
    tokens: Math.round(chars / 4),
    largest: sizes.sort((a, b) => b.chars - a.chars).slice(0, 3).map((t) => ({ name: t.name, tokens: Math.round(t.chars / 4) })),
    measuredAt: Date.now(),
  };
}

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "guardbee-token-optimizer", version: "1" } };

/** Starts a stdio server, lists its tools (following pagination) and stops it. */
export function listToolsStdio(server: ConfiguredServer, timeoutMs: number): Promise<Tool[]> {
  const c = server.config;
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_PLUGIN_ROOT: server.pluginRoot };
  for (const [k, v] of Object.entries(c.env ?? {})) env[k] = expandVars(String(v), env);
  const command = expandVars(c.command ?? "", env);
  const args = (c.args ?? []).map((a) => expandVars(String(a), env));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd: server.project ?? server.pluginRoot, stdio: ["pipe", "pipe", "ignore"] });
    const tools: Tool[] = [];
    let buffer = "";
    let nextId = 1;
    const timer = setTimeout(() => finish(new Error(`no answer within ${timeoutMs / 1000}s`)), timeoutMs);
    function send(msg: Record<string, unknown>): void {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
    }
    let done = false;
    function finish(error?: Error): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(tools);
    }
    child.on("error", (e) => finish(e));
    child.on("exit", (code) => finish(new Error(`exited with code ${code} before listing tools`)));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number; result?: { tools?: Tool[]; nextCursor?: string }; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // a server logging to stdout
        }
        if (msg.error) return finish(new Error(msg.error.message ?? "error"));
        if (msg.id === 1) {
          send({ method: "notifications/initialized" });
          send({ id: ++nextId, method: "tools/list", params: {} });
        } else if (msg.id === nextId && msg.result) {
          tools.push(...(msg.result.tools ?? []));
          if (msg.result.nextCursor) send({ id: ++nextId, method: "tools/list", params: { cursor: msg.result.nextCursor } });
          else finish();
        }
      }
    });
    send({ id: 1, method: "initialize", params: INIT });
  });
}

async function rpcHttp(url: string, headers: Record<string, string>, body: Record<string, unknown>, timeoutMs: number): Promise<{ result?: Record<string, unknown>; session?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`needs authorization (HTTP ${res.status}); sign in from Claude Code's /mcp`);
  if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}`);
  const session = res.headers.get("mcp-session-id") ?? undefined;
  if (!("id" in body)) return { session };
  const text = await res.text();
  // Streamable HTTP may answer with an SSE stream; the response is in a data: line
  const payloads = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  for (const p of payloads) {
    try {
      const msg = JSON.parse(p) as { id?: unknown; result?: Record<string, unknown>; error?: { message?: string } };
      if (msg.error) throw new Error(msg.error.message ?? "error");
      if (msg.id === body.id) return { result: msg.result, session };
    } catch (e) {
      if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
    }
  }
  throw new Error("no JSON-RPC response");
}

export async function listToolsHttp(server: ConfiguredServer, timeoutMs: number): Promise<Tool[]> {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: server.pluginRoot };
  const url = expandVars(server.config.url ?? "", env);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(server.config.headers ?? {})) headers[k] = expandVars(String(v), env);
  const init = await rpcHttp(url, headers, { id: 1, method: "initialize", params: INIT }, timeoutMs);
  if (init.session) headers["mcp-session-id"] = init.session;
  await rpcHttp(url, headers, { method: "notifications/initialized" }, timeoutMs);
  const tools: Tool[] = [];
  let cursor: string | undefined;
  let id = 2;
  do {
    const { result } = await rpcHttp(url, headers, { id: id++, method: "tools/list", params: cursor ? { cursor } : {} }, timeoutMs);
    tools.push(...((result?.tools as Tool[]) ?? []));
    cursor = result?.nextCursor as string | undefined;
  } while (cursor);
  return tools;
}

/**
 * Starts each server the way Claude Code would and measures the tool definitions it advertises.
 * This runs the configured commands, so it only happens on request. The figure is what the
 * definitions cost when loaded up front; Claude Code defers MCP tools behind a search when there
 * are many, in which case they cost much less until used.
 */
export async function measureDefinitions(servers: ConfiguredServer[], timeoutMs = 20_000): Promise<DefinitionCost[]> {
  return Promise.all(
    servers.map(async (s): Promise<DefinitionCost> => {
      try {
        const remote = s.config.type === "http" || s.config.type === "sse" || (!s.config.command && !!s.config.url);
        if (s.config.type === "sse") throw new Error("legacy SSE transport is not measured");
        const tools = remote ? await listToolsHttp(s, timeoutMs) : await listToolsStdio(s, timeoutMs);
        return cost(s, tools);
      } catch (error) {
        return { name: s.name, scope: s.scope, project: s.project, ok: false, error: (error as Error).message, tools: 0, chars: 0, tokens: 0, largest: [], measuredAt: Date.now() };
      }
    })
  );
}

function cacheFile(paths: ClaudePaths): string {
  return join(paths.stateDir, "..", "token-optimizer", "mcp-definitions.json");
}

export function saveDefinitionCosts(costs: DefinitionCost[], paths?: Partial<ClaudePaths>): void {
  const file = cacheFile(resolvePaths(paths));
  mkdirSync(join(file, ".."), { recursive: true });
  const previous = readDefinitionCosts(paths).filter((p) => !costs.some((c) => c.name === p.name && c.scope === p.scope && c.project === p.project));
  writeFileSync(file, JSON.stringify([...previous, ...costs], null, 2));
}

/** Last measurements, so the optimization report can use them without starting servers again. */
export function readDefinitionCosts(paths?: Partial<ClaudePaths>): DefinitionCost[] {
  try {
    return JSON.parse(readFileSync(cacheFile(resolvePaths(paths)), "utf8")) as DefinitionCost[];
  } catch {
    return [];
  }
}

export function formatDefinitionCosts(costs: DefinitionCost[]): string {
  if (costs.length === 0) return "No MCP servers to measure.";
  const sorted = [...costs].sort((a, b) => b.tokens - a.tokens);
  const total = sorted.reduce((s, c) => s + c.tokens, 0);
  const lines = [`Tool definitions: ~${compact(total)} tokens across ${costs.filter((c) => c.ok).length} server(s) (if loaded up front)`, ""];
  for (const c of sorted) {
    const where = `${c.scope}${c.project ? `, ${c.project}` : ""}`;
    if (!c.ok) lines.push(`✗ ${c.name} (${where}): ${c.error}`);
    else lines.push(`${compact(c.tokens).padStart(6)}  ${c.name} (${where}) — ${c.tools} tools${c.largest.length ? `; largest: ${c.largest.map((t) => `${t.name} ~${compact(t.tokens)}`).join(", ")}` : ""}`);
  }
  lines.push("", "Claude Code defers MCP tools behind tool search when there are many; then only names cost context until a tool is used.");
  return lines.join("\n");
}
