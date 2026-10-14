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
  ];
  const cline = (codeUser: string) => join(codeUser, "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");

  if (os === "darwin") {
    paths.push(
      { client: "claude-desktop", path: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json") },
      { client: "vscode", path: join(home, "Library", "Application Support", "Code", "User", "mcp.json") },
      { client: "vscode-insiders", path: join(home, "Library", "Application Support", "Code - Insiders", "User", "mcp.json") },
      { client: "cursor-app", path: join(home, "Library", "Application Support", "Cursor", "User", "mcp.json") },
      { client: "cline", path: cline(join(home, "Library", "Application Support", "Code", "User")) },
      { client: "zed", path: join(home, ".config", "zed", "settings.json") }
    );
  } else if (os === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    paths.push(
      { client: "claude-desktop", path: join(appData, "Claude", "claude_desktop_config.json") },
      { client: "vscode", path: join(appData, "Code", "User", "mcp.json") },
      { client: "vscode-insiders", path: join(appData, "Code - Insiders", "User", "mcp.json") },
      { client: "cursor-app", path: join(appData, "Cursor", "User", "mcp.json") },
      { client: "cline", path: cline(join(appData, "Code", "User")) },
      { client: "zed", path: join(appData, "Zed", "settings.json") }
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
      { client: "zed", path: join(config, "zed", "settings.json") }
    );
  }

  return paths;
}

/** Clients whose file is a general settings file: no MCP servers in it is normal, not an error. */
const SETTINGS_FILES = new Set(["claude-code", "gemini-cli", "zed"]);

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

/**
 * The MCP servers in one client's file, grouped by where they apply. Claude
 * Code keeps user servers at the top of ~/.claude.json and per-project
 * servers under projects["<path>"].mcpServers.
 */
export function parseHostConfig(client: string, text: string): { groups: Array<{ client: string; servers: ParsedServer[] }>; error?: string } {
  let root: Record<string, unknown> | null;
  try {
    root = record(JSON.parse(stripJsonc(text)));
  } catch (err) {
    return { groups: [], error: err instanceof Error ? err.message : String(err) };
  }
  if (!root) return { groups: [], error: "Config root is not a JSON object" };
  if (client === "zed") return { groups: [{ client, servers: zedServers(root) }] };
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
