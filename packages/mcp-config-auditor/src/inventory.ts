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

export function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    if (index > 0 && SECRET_FLAG.test(args[index - 1]!)) return REDACTED;
    const assign = SECRET_ASSIGN.exec(arg);
    if (assign) return `${assign[1]}${REDACTED}`;
    if (looksLikeSecret(arg)) return REDACTED;
    // A connection string with a password
    return arg.replace(/(\w+:\/\/[^:/@\s]+:)[^@/\s]+@/g, `$1${REDACTED}@`);
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

function entryFor(client: string, configPath: string, server: ParsedServer, findings: ConfigFinding[]): InventoryEntry {
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
  };
}

export function buildInventory(result: DiscoverResult, options: { includeUser?: boolean; now?: Date } = {}): InventoryReport {
  const servers = result.discovered.flatMap((d) => d.servers.map((server) => entryFor(d.client, d.path, server, result.findings)));
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
