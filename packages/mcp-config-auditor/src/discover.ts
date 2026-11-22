import { existsSync, readFileSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { packageSpec, parseMcpConfig, splitPackageSpec } from "./parseConfig.js";
import type { ConfigFinding, ParsedServer } from "./types.js";

export interface HostConfigPath {
  /** Client label shown in findings (cursor, claude-desktop, …). */
  client: string;
  path: string;
}

export interface Allowlist {
  /** Approved MCP server entry names (config keys). */
  names: Set<string>;
  /** Approved npm/PyPI package names (version stripped). */
  packages: Set<string>;
  /** Approved remote URL hosts (lowercase). */
  hosts: Set<string>;
}

export interface DiscoverResult {
  scannedFiles: number;
  missingPaths: number;
  findings: ConfigFinding[];
  durationMs: number;
  discovered: Array<{ client: string; path: string; servers: ParsedServer[] }>;
}

/** Well-known per-user MCP client config locations (OWASP MCP09 discovery surface). */
export function defaultHostConfigPaths(home: string = homedir(), os: NodeJS.Platform = platform()): HostConfigPath[] {
  const paths: HostConfigPath[] = [
    { client: "cursor", path: join(home, ".cursor", "mcp.json") },
    { client: "claude-code", path: join(home, ".claude.json") },
    { client: "windsurf", path: join(home, ".codeium", "windsurf", "mcp_config.json") },
    { client: "gemini-cli", path: join(home, ".gemini", "settings.json") },
    { client: "codex", path: join(process.env.CODEX_HOME ?? join(home, ".codex"), "config.toml") },
    { client: "kiro", path: join(home, ".kiro", "settings", "mcp.json") },
    { client: "copilot-cli", path: join(home, ".copilot", "mcp-config.json") },
    { client: "amazon-q", path: join(home, ".aws", "amazonq", "mcp.json") },
    { client: "lm-studio", path: join(home, ".lmstudio", "mcp.json") },
  ];
  const cline = (codeUser: string) => join(codeUser, "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  const roo = (codeUser: string) => join(codeUser, "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json");

  if (os === "darwin") {
    paths.push(
      { client: "claude-desktop", path: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json") },
      { client: "vscode", path: join(home, "Library", "Application Support", "Code", "User", "mcp.json") },
      { client: "vscode-insiders", path: join(home, "Library", "Application Support", "Code - Insiders", "User", "mcp.json") },
      { client: "cursor-app", path: join(home, "Library", "Application Support", "Cursor", "User", "mcp.json") },
      { client: "cline", path: cline(join(home, "Library", "Application Support", "Code", "User")) },
      { client: "roo-code", path: roo(join(home, "Library", "Application Support", "Code", "User")) },
      { client: "zed", path: join(home, ".config", "zed", "settings.json") },
      { client: "opencode", path: join(home, ".config", "opencode", "opencode.json") }
    );
  } else if (os === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    paths.push(
      { client: "claude-desktop", path: join(appData, "Claude", "claude_desktop_config.json") },
      { client: "vscode", path: join(appData, "Code", "User", "mcp.json") },
      { client: "vscode-insiders", path: join(appData, "Code - Insiders", "User", "mcp.json") },
      { client: "cursor-app", path: join(appData, "Cursor", "User", "mcp.json") },
      { client: "cline", path: cline(join(appData, "Code", "User")) },
      { client: "roo-code", path: roo(join(appData, "Code", "User")) },
      { client: "zed", path: join(appData, "Zed", "settings.json") },
      { client: "opencode", path: join(home, ".config", "opencode", "opencode.json") }
    );
  } else {
    // linux / others
    const config = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
    paths.push(
      { client: "claude-desktop", path: join(config, "Claude", "claude_desktop_config.json") },
      { client: "vscode", path: join(config, "Code", "User", "mcp.json") },
      { client: "vscode-insiders", path: join(config, "Code - Insiders", "User", "mcp.json") },
      { client: "cursor-app", path: join(config, "Cursor", "User", "mcp.json") },
      { client: "cline", path: cline(join(config, "Code", "User")) },
      { client: "roo-code", path: roo(join(config, "Code", "User")) },
      { client: "zed", path: join(config, "zed", "settings.json") },
      { client: "opencode", path: join(config, "opencode", "opencode.json") }
    );
  }

  return paths;
}

/** Clients whose file is a general settings file: no MCP servers in it is normal, not an error. */
const SETTINGS_FILES = new Set(["claude-code", "gemini-cli", "zed", "codex", "opencode"]);

/** JSON with comments and trailing commas (Zed, VS Code), made parseable; strings are left intact. */
export function stripJsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Zed's context_servers: { name: { command: { path, args, env } } } or the flat / url forms. */
function zedServers(root: Record<string, unknown>): ParsedServer[] {
  const servers = record(root["context_servers"]);
  if (!servers) return [];
  return Object.entries(servers).flatMap(([name, value]) => {
    const rec = record(value);
    if (!rec) return [];
    const nested = record(rec["command"]);
    const command = nested ? nested["path"] : rec["command"];
    const args = (nested ? nested["args"] : rec["args"]) as unknown;
    const env = record(nested ? nested["env"] : rec["env"]) ?? {};
    return [
      {
        name,
        ...(typeof command === "string" ? { command } : {}),
        args: Array.isArray(args) ? args.filter((a): a is string => typeof a === "string") : [],
        env: Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string")),
        ...(typeof rec["url"] === "string" ? { url: rec["url"] } : {}),
        headers: {},
        autoApprove: undefined,
      },
    ];
  });
}

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value) ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** opencode's "mcp": { name: { type: "local", command: [cmd, ...args], environment } | { type: "remote", url, headers } }. */
function opencodeServers(root: Record<string, unknown>): ParsedServer[] {
  return Object.entries(record(root["mcp"]) ?? {}).flatMap(([name, value]) => {
    const rec = record(value);
    if (!rec) return [];
    const command = Array.isArray(rec["command"]) ? rec["command"].filter((a): a is string => typeof a === "string") : [];
    return [
      {
        name,
        ...(command[0] ? { command: command[0] } : {}),
        args: command.slice(1),
        env: stringMap(rec["environment"]),
        ...(typeof rec["url"] === "string" ? { url: rec["url"] } : {}),
        headers: stringMap(rec["headers"]),
        autoApprove: undefined,
        ...(rec["enabled"] === false ? { disabled: true } : {}),
      },
    ];
  });
}

/** One TOML value of the kinds Codex's MCP tables use: string, number, boolean, array of strings, inline table of strings. */
function tomlValue(raw: string): unknown {
  const text = raw.trim();
  if (text.startsWith('"') || text.startsWith("'")) return tomlString(text).value;
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("[")) return tomlItems(text.slice(1, text.lastIndexOf("]"))).map((item) => tomlValue(item));
  if (text.startsWith("{")) {
    const out: Record<string, unknown> = {};
    for (const item of tomlItems(text.slice(1, text.lastIndexOf("}")))) {
      const eq = item.indexOf("=");
      if (eq > 0) out[tomlKey(item.slice(0, eq))] = tomlValue(item.slice(eq + 1));
    }
    return out;
  }
  return text;
}

function tomlString(text: string): { value: string; end: number } {
  const quote = text[0]!;
  let value = "";
  let i = 1;
  for (; i < text.length && text[i] !== quote; i++) {
    if (quote === '"' && text[i] === "\\" && i + 1 < text.length) {
      const next = text[++i]!;
      value += next === "n" ? "\n" : next === "t" ? "\t" : next;
    } else value += text[i];
  }
  return { value, end: i };
}

/** Split a TOML array or inline-table body on top-level commas. */
function tomlItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '"' || ch === "'") i += tomlString(body.slice(i)).end;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      items.push(body.slice(start, i));
      start = i + 1;
    }
  }
  items.push(body.slice(start));
  return items.map((item) => item.trim()).filter(Boolean);
}

function tomlKey(raw: string): string {
  const key = raw.trim();
  return key.startsWith('"') || key.startsWith("'") ? tomlString(key).value : key;
}

/** Split a dotted table header (mcp_servers."my.server".env) into its keys. */
function tomlPath(header: string): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < header.length) {
    const ch = header[i]!;
    if (ch === '"' || ch === "'") {
      const { value, end } = tomlString(header.slice(i));
      parts.push(value);
      i += end + 1;
    } else if (ch === ".") i++;
    else {
      let j = i;
      while (j < header.length && header[j] !== ".") j++;
      parts.push(header.slice(i, j).trim());
      i = j;
    }
  }
  return parts;
}

/** Drop a # comment that is not inside a string. */
function stripTomlComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"' || ch === "'") i += tomlString(line.slice(i)).end;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

/**
 * Codex keeps MCP servers in ~/.codex/config.toml as [mcp_servers.<name>]
 * tables (and [mcp_servers.<name>.env] sub-tables). Only those tables are
 * read; a value that spans several lines is joined until its brackets close.
 */
export function parseCodexToml(text: string): ParsedServer[] {
  const tables = new Map<string, Record<string, unknown>>();
  let current: Record<string, unknown> | null = null;
  let sub: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    let line = stripTomlComment(lines[n]!).trim();
    if (!line) continue;
    const header = /^\[([^\[\]]+)\]$/.exec(line);
    if (header) {
      const path = tomlPath(header[1]!);
      if (path[0] === "mcp_servers" && path[1]) {
        const table = tables.get(path[1]) ?? {};
        tables.set(path[1], table);
        current = table;
        sub = path[2] ?? null;
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let raw = line.slice(eq + 1);
    const balance = (value: string) => {
      let depth = 0;
      for (let i = 0; i < value.length; i++) {
        const ch = value[i]!;
        if (ch === '"' || ch === "'") i += tomlString(value.slice(i)).end;
        else if (ch === "[" || ch === "{") depth++;
        else if (ch === "]" || ch === "}") depth--;
      }
      return depth;
    };
    while (balance(raw) > 0 && n + 1 < lines.length) raw += " " + stripTomlComment(lines[++n]!).trim();
    const key = tomlKey(line.slice(0, eq));
    if (sub) {
      const nested = record(current[sub]) ?? {};
      nested[key] = tomlValue(raw);
      current[sub] = nested;
    } else current[key] = tomlValue(raw);
  }
  return [...tables].map(([name, rec]) => ({
    name,
    ...(typeof rec["command"] === "string" ? { command: rec["command"] } : {}),
    args: Array.isArray(rec["args"]) ? rec["args"].filter((a): a is string => typeof a === "string") : [],
    env: stringMap(rec["env"]),
    ...(typeof rec["url"] === "string" ? { url: rec["url"] } : {}),
    headers: stringMap(rec["http_headers"] ?? rec["headers"]),
    autoApprove: undefined,
    ...(rec["enabled"] === false ? { disabled: true } : {}),
  }));
}

/**
 * The MCP servers in one client's file, grouped by where they apply. Claude
 * Code keeps user servers at the top of ~/.claude.json and per-project
 * servers under projects["<path>"].mcpServers.
 */
export function parseHostConfig(client: string, text: string): { groups: Array<{ client: string; servers: ParsedServer[] }>; error?: string } {
  if (client === "codex") {
    try {
      return { groups: [{ client, servers: parseCodexToml(text) }] };
    } catch (err) {
      return { groups: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
  let root: Record<string, unknown> | null;
  try {
    root = record(JSON.parse(stripJsonc(text)));
  } catch (err) {
    return { groups: [], error: err instanceof Error ? err.message : String(err) };
  }
  if (!root) return { groups: [], error: "Config root is not a JSON object" };
  if (client === "zed") return { groups: [{ client, servers: zedServers(root) }] };
  if (client === "opencode") return { groups: [{ client, servers: opencodeServers(root) }] };
  const top = parseMcpConfig(JSON.stringify(root));
  const groups: Array<{ client: string; servers: ParsedServer[] }> = [];
  if (!top.error) groups.push({ client, servers: top.servers });
  if (client === "claude-code") {
    for (const [project, value] of Object.entries(record(root["projects"]) ?? {})) {
      const scoped = record(value);
      if (!scoped || !record(scoped["mcpServers"])) continue;
      const parsed = parseMcpConfig(JSON.stringify({ mcpServers: scoped["mcpServers"] }));
      if (parsed.servers.length > 0) groups.push({ client: `claude-code:${project}`, servers: parsed.servers });
    }
  }
  if (groups.length === 0 && !SETTINGS_FILES.has(client)) return { groups: [], error: top.error ?? "No MCP servers found" };
  return { groups };
}

export function parseAllowlist(text: string): Allowlist {
  const names = new Set<string>();
  const packages = new Set<string>();
  const hosts = new Set<string>();

  const trimmed = text.trim();
  if (!trimmed) return { names, packages, hosts };

  // JSON object form
  if (trimmed.startsWith("{")) {
    let root: unknown;
    try {
      root = JSON.parse(trimmed);
    } catch {
      throw new Error("Allowlist JSON could not be parsed");
    }
    const rec = root && typeof root === "object" && !Array.isArray(root) ? (root as Record<string, unknown>) : null;
    if (!rec) throw new Error("Allowlist JSON root must be an object");
    for (const key of ["names", "servers", "serverNames"] as const) {
      const list = rec[key];
      if (Array.isArray(list)) {
        for (const item of list) if (typeof item === "string" && item.trim()) names.add(item.trim());
      }
    }
    for (const key of ["packages", "packageNames"] as const) {
      const list = rec[key];
      if (Array.isArray(list)) {
        for (const item of list) if (typeof item === "string" && item.trim()) packages.add(normalizePackage(item.trim()));
      }
    }
    for (const key of ["hosts", "urls"] as const) {
      const list = rec[key];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item !== "string" || !item.trim()) continue;
          const host = hostFromAllowEntry(item.trim());
          if (host) hosts.add(host);
        }
      }
    }
    return { names, packages, hosts };
  }

  // Line-oriented: name:<x> | package:<x> | host:<x> | bare token → name
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon > 0) {
      const kind = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (!value) continue;
      if (kind === "name" || kind === "server" || kind === "servers") names.add(value);
      else if (kind === "package" || kind === "pkg") packages.add(normalizePackage(value));
      else if (kind === "host" || kind === "url") {
        const host = hostFromAllowEntry(value);
        if (host) hosts.add(host);
      } else {
        names.add(line);
      }
    } else if (line.startsWith("@") || line.includes("/")) {
      packages.add(normalizePackage(line));
    } else {
      names.add(line);
    }
  }
  return { names, packages, hosts };
}

export function loadAllowlistFile(filePath: string): Allowlist {
  return parseAllowlist(readFileSync(filePath, "utf8"));
}

function normalizePackage(spec: string): string {
  return splitPackageSpec(spec).name.toLowerCase();
}

function hostFromAllowEntry(value: string): string | null {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return value.toLowerCase() || null;
  }
}

function serverPackage(server: ParsedServer): string | null {
  const spec = packageSpec(server.command, server.args);
  return spec ? normalizePackage(spec) : null;
}

function serverHost(server: ParsedServer): string | null {
  if (!server.url) return null;
  try {
    return new URL(server.url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowed(server: ParsedServer, allowlist: Allowlist): boolean {
  if (allowlist.names.has(server.name)) return true;
  const pkg = serverPackage(server);
  if (pkg && allowlist.packages.has(pkg)) return true;
  const host = serverHost(server);
  if (host && allowlist.hosts.has(host)) return true;
  return false;
}

function finding(
  partial: Omit<ConfigFinding, "line" | "column"> & { line?: number; column?: number }
): ConfigFinding {
  return { line: 1, column: 1, ...partial };
}

/**
 * Walk well-known MCP client config paths and flag servers that are not on an
 * organization allowlist (OWASP MCP09:2025 — Shadow MCP Servers).
 */
export function discoverShadowMcp(options: {
  home?: string;
  paths?: HostConfigPath[];
  allowlist?: Allowlist | null;
  /** Also emit content-audit findings from each readable config (default false). */
  includeContentAudit?: boolean;
  contentAudit?: (text: string, file: string) => ConfigFinding[];
} = {}): DiscoverResult {
  const start = Date.now();
  const paths = options.paths ?? defaultHostConfigPaths(options.home);
  const allowlist = options.allowlist ?? null;
  const findings: ConfigFinding[] = [];
  const discovered: DiscoverResult["discovered"] = [];
  let scannedFiles = 0;
  let missingPaths = 0;

  for (const entry of paths) {
    if (!existsSync(entry.path)) {
      missingPaths++;
      continue;
    }
    let text: string;
    try {
      text = readFileSync(entry.path, "utf8");
    } catch {
      missingPaths++;
      continue;
    }
    scannedFiles++;
    const host = parseHostConfig(entry.client, text);
    if (host.error) {
      findings.push(
        finding({
          patternId: "shadow_config_unreadable",
          patternName: "Shadow discovery found an unreadable MCP config",
          category: "shadow-mcp",
          severity: "medium",
          owasp: "MCP09:2025",
          recommendation:
            "A client config on this machine could not be parsed, so it cannot be checked against the allowlist. Fix the JSON or remove the file.",
          file: entry.path,
          match: `${entry.client}: ${host.error}`.slice(0, 200),
        })
      );
      discovered.push({ client: entry.client, path: entry.path, servers: [] });
      continue;
    }

    for (const group of host.groups) discovered.push({ client: group.client, path: entry.path, servers: group.servers });

    if (options.includeContentAudit && options.contentAudit && host.groups.some((group) => group.servers.length > 0)) {
      findings.push(...options.contentAudit(text, entry.path));
    }
    for (const group of host.groups) {
      for (const server of group.servers) {
        const pkg = serverPackage(server);
        if (!allowlist) {
          const identity = pkg ?? server.url ?? server.command ?? server.name;
          findings.push(
            finding({
              patternId: "unreviewed_mcp_server",
              patternName: "MCP server discovered with no organization allowlist",
              category: "shadow-mcp",
              severity: "low",
              owasp: "MCP09:2025",
              recommendation:
                "Pass an allowlist file (`names` / `packages` / `hosts`) so unapproved Shadow MCP servers can be flagged as high severity. Until then, treat every discovered server as unreviewed.",
              server: server.name,
              file: entry.path,
              match: `${group.client}: ${identity}`.slice(0, 200),
            })
          );
          continue;
        }
        if (isAllowed(server, allowlist)) continue;
        const identity = pkg ?? server.url ?? server.command ?? "(local command)";
        findings.push(
          finding({
            patternId: "shadow_mcp_server",
            patternName: "Shadow MCP server not on the organization allowlist",
            category: "shadow-mcp",
            severity: "high",
            owasp: "MCP09:2025",
            recommendation:
              "This server is installed in a client config but is not on the approved allowlist (OWASP MCP09). Remove it, or add its name/package/host to the allowlist after a security review.",
            server: server.name,
            file: entry.path,
            match: `${group.client}: ${identity}`.slice(0, 200),
          })
        );
      }
    }
  }

  if (!allowlist && scannedFiles > 0) {
    findings.unshift(
      finding({
        patternId: "allowlist_not_configured",
        patternName: "No MCP allowlist provided for shadow discovery",
        category: "shadow-mcp",
        severity: "medium",
        owasp: "MCP09:2025",
        recommendation:
          "Provide an allowlist JSON or line file so discovery can distinguish approved servers from Shadow MCP (unapproved) ones. Example: { \"names\": [\"filesystem\"], \"packages\": [\"@modelcontextprotocol/server-filesystem\"] }.",
        match: `${scannedFiles} config(s) discovered`,
      })
    );
  }

  // Same server name on two clients with different package/url → governance drift
  const byName = new Map<string, Array<{ client: string; path: string; identity: string }>>();
  for (const item of discovered) {
    for (const server of item.servers) {
      const identity = serverPackage(server) ?? server.url ?? server.command ?? "";
      const list = byName.get(server.name) ?? [];
      list.push({ client: item.client, path: item.path, identity });
      byName.set(server.name, list);
    }
  }
  for (const [name, entries] of byName) {
    const identities = new Set(entries.map((e) => e.identity));
    if (identities.size <= 1 || entries.length < 2) continue;
    findings.push(
      finding({
        patternId: "mcp_server_drift_across_clients",
        patternName: "Same MCP server name points to different backends across clients",
        category: "shadow-mcp",
        severity: "medium",
        owasp: "MCP09:2025",
        recommendation:
          "The same server key is wired to different packages or URLs in different clients. Align them or rename one so operators know which deployment is approved.",
        server: name,
        file: entries[0]?.path,
        match: entries.map((e) => `${e.client}=${e.identity || "?"}`).join("; ").slice(0, 200),
      })
    );
  }

  return {
    scannedFiles,
    missingPaths,
    findings,
    durationMs: Date.now() - start,
    discovered,
  };
}
