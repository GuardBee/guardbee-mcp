import { hostname, platform, userInfo } from "os";
import { isPinnedVersion, packageSpec, splitPackageSpec } from "./parseConfig.js";
import { looksLikeSecret } from "./secrets.js";
import type { DiscoverResult } from "./discover.js";
import type { ConfigFinding, ParsedServer } from "./types.js";

/**
 * What is installed where, for an organisation-wide MCP inventory. Built from
 * a discovery run; never carries a secret: env and header values are left
 * out (names only), argument values after secret-like flags or that look
 * like tokens are redacted, and URLs lose their credentials and query values.
 */
export interface InventoryEntry {
  client: string;
  configPath: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args: string[];
  package?: { name: string; version: string | null; pinned: boolean };
  url?: string;
  envKeys: string[];
  headerKeys: string[];
  autoApprove: boolean;
  /** patternIds of the discovery findings for this server in this file. */
  findings: string[];
  /** GuardBee MCP Index grade (with --grades); null when the server has none. */
  grade?: string | null;
}

export interface InventoryReport {
  schema: "guardbee.mcp-inventory/1";
  collectedAt: string;
  source: { host: string; os: string; user?: string };
  servers: InventoryEntry[];
  summary: { configs: number; servers: number; shadow: number; unreviewed: number };
}

const SECRET_FLAG = /^--?(?:api[-_]?key|token|access[-_]?token|secret|password|passwd|auth|bearer|key|private[-_]?key|client[-_]?secret)$/i;
const SECRET_ASSIGN = /^(--?[\w-]*(?:key|token|secret|password|passwd|auth)[\w-]*=|[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=)(.+)$/i;
const REDACTED = "[redacted]";

/** scheme://user:password@host → scheme://user:[redacted]@host, scanned without a backtracking regex. */
function redactUrlPasswords(text: string): string {
  let out = "";
  let from = 0;
  for (let at = text.indexOf("://"); at >= 0; at = text.indexOf("://", at + 3)) {
    const authority = at + 3;
    let end = authority;
    while (end < text.length && !"/@ \t\n".includes(text[end]!)) end++;
    if (text[end] !== "@") continue;
    const colon = text.indexOf(":", authority);
    if (colon < 0 || colon >= end || colon === authority) continue;
    out += `${text.slice(from, colon + 1)}${REDACTED}`;
    from = end;
  }
  return out + text.slice(from);
}

export function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    if (index > 0 && SECRET_FLAG.test(args[index - 1]!)) return REDACTED;
    const assign = SECRET_ASSIGN.exec(arg);
    if (assign) return `${assign[1]}${REDACTED}`;
    if (looksLikeSecret(arg)) return REDACTED;
    // A connection string with a password
    return redactUrlPasswords(arg);
  });
}

/** Scheme, host, port and path; credentials dropped, query values hidden. */
export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "…");
    url.hash = "";
    return url.toString();
  } catch {
    return "[unparseable url]";
  }
}

/** Key of a server in a config file, for the grade map. */
export const inventoryKey = (configPath: string, name: string) => `${configPath}\u0000${name}`;

function entryFor(client: string, configPath: string, server: ParsedServer, findings: ConfigFinding[], grades?: Map<string, string | null>): InventoryEntry {
  const grade = grades?.get(inventoryKey(configPath, server.name));
  const spec = packageSpec(server.command, server.args);
  const pkg = spec ? splitPackageSpec(spec) : null;
  return {
    client,
    configPath,
    name: server.name,
    transport: server.url ? "http" : "stdio",
    ...(server.command ? { command: server.command } : {}),
    args: redactArgs(server.args),
    ...(pkg ? { package: { name: pkg.name, version: pkg.version, pinned: isPinnedVersion(pkg.version) } } : {}),
    ...(server.url ? { url: sanitizeUrl(server.url) } : {}),
    envKeys: Object.keys(server.env).sort(),
    headerKeys: Object.keys(server.headers).sort(),
    autoApprove: Array.isArray(server.autoApprove) ? server.autoApprove.length > 0 : Boolean(server.autoApprove),
    findings: [...new Set(findings.filter((f) => f.server === server.name && f.file === configPath).map((f) => f.patternId))],
    ...(grade !== undefined ? { grade } : {}),
  };
}

export function buildInventory(result: DiscoverResult, options: { includeUser?: boolean; now?: Date; grades?: Map<string, string | null> } = {}): InventoryReport {
  const servers = result.discovered.flatMap((d) => d.servers.map((server) => entryFor(d.client, d.path, server, result.findings, options.grades)));
  let user: string | undefined;
  if (options.includeUser !== false) {
    try {
      user = userInfo().username;
    } catch {
      user = undefined;
    }
  }
  return {
    schema: "guardbee.mcp-inventory/1",
    collectedAt: (options.now ?? new Date()).toISOString(),
    source: { host: hostname(), os: platform(), ...(user ? { user } : {}) },
    servers,
    summary: {
      configs: result.scannedFiles,
      servers: servers.length,
      shadow: servers.filter((s) => s.findings.includes("shadow_mcp_server")).length,
      unreviewed: servers.filter((s) => s.findings.includes("unreviewed_mcp_server")).length,
    },
  };
}

export const DEFAULT_UPLOAD_URL = "https://app.guardbee.ai/api/v1/mcp/inventory";

/** Send an inventory to the GuardBee dashboard with a workspace API key (scope gateway.write). */
export async function uploadInventory(report: InventoryReport, options: { apiKey: string; url?: string; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; status: number; message: string }> {
  const response = await (options.fetchImpl ?? fetch)(options.url ?? DEFAULT_UPLOAD_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, message: text.slice(0, 300) };
}

/** The dashboard's allowlist endpoint next to the upload endpoint (same origin). */
export function allowlistUrlFor(uploadUrl: string = DEFAULT_UPLOAD_URL): string {
  return new URL("/api/v1/mcp/allowlist", uploadUrl).toString();
}

/**
 * The organization allowlist managed in the GuardBee dashboard, in the
 * allowlist file format (`{ names, packages, hosts }`), so every machine
 * checks against the same list. Needs a workspace API key with gateway.read
 * or gateway.write.
 */
export async function fetchDashboardAllowlist(options: { apiKey: string; url?: string; fetchImpl?: typeof fetch }): Promise<{ names: string[]; packages: string[]; hosts: string[] }> {
  const response = await (options.fetchImpl ?? fetch)(options.url ?? allowlistUrlFor(), {
    headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { data?: { names?: unknown; packages?: unknown; hosts?: unknown }; error?: string };
  if (!response.ok || !body.data) throw new Error(`dashboard allowlist: HTTP ${response.status}${body.error ? ` ${body.error}` : ""}`);
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  return { names: list(body.data.names), packages: list(body.data.packages), hosts: list(body.data.hosts) };
}
