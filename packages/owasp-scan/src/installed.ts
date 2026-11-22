import { homedir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import {
  discoverShadowMcp,
  loadAllowlistFile,
  scanInventory,
  type Allowlist,
  type HostConfigPath,
  type ParsedServer,
} from "@guardbee/mcp-config-auditor";
import { auditCatalog } from "@guardbee/mcp-toxic-flow-auditor";
import { diffTools, hashTool, loadBaseline, saveBaseline, type ServerBaseline } from "@guardbee/mcp-rug-pull-detector";
import { buildReport, catalogFindings, pushNormalized } from "./orchestrator.js";
import { connectAndListTools, type LiveServerInfo, type LiveTool } from "./mcpClient.js";
import type { ConnectionTarget, InstalledServer, NormalizedFinding, OwaspReport } from "./types.js";

export interface InstalledScanOptions {
  /** Shadow MCP allowlist (MCP09). A path is loaded with `loadAllowlistFile`. */
  allowlist?: Allowlist | null;
  allowlistPath?: string;
  /**
   * Start local (stdio) servers to read their tools. Off by default: starting
   * a server runs its code on this machine, with the env from the client config.
   */
  runStdio?: boolean;
  /** Per-server connect and tools/list timeout. Default 15 s. */
  timeoutMs?: number;
  /**
   * Where tool pins are kept between runs, so a definition that changes after
   * the first scan is reported as a rug pull. Default ~/.guardbee/tool-pins;
   * `false` turns pinning off.
   */
  pinDir?: string | false;
  /** Config files to read instead of the well-known client locations (tests, fleet agents). */
  paths?: HostConfigPath[];
  home?: string;
  /** Replaces the MCP client (tests). */
  connect?: (target: ConnectionTarget, timeoutMs: number) => Promise<LiveServerInfo>;
}

export const DEFAULT_PIN_DIR = join(homedir(), ".guardbee", "tool-pins");

interface Candidate {
  key: string;
  server: ParsedServer;
  clients: string[];
  configPaths: string[];
}

/** Same command line or URL in several clients is one server, contacted once. */
function identity(server: ParsedServer): string {
  if (server.url) return `http ${server.url}`;
  return `stdio ${[server.command ?? "", ...server.args].join(" ")}`;
}

function target(server: ParsedServer): ConnectionTarget | null {
  if (server.url) return { type: "http", url: server.url, headers: server.headers, transport: "auto" };
  if (server.command) return { type: "stdio", command: server.command, args: server.args, env: server.env };
  return null;
}

/** Pins are keyed by what was connected to, never by anything secret (env and header values stay out). */
function pinId(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
}

function checkPins(pinDir: string, key: string, label: string, live: LiveServerInfo): NormalizedFinding[] {
  const serverId = pinId(key);
  const existing = loadBaseline(pinDir, serverId);
  const now = new Date().toISOString();
  if (!existing) {
    const baseline: ServerBaseline = {
      serverId,
      target: label,
      serverInfo: live.serverInfo,
      capturedAt: now,
      tools: Object.fromEntries(live.tools.map((t) => [t.name, { hash: hashTool(t), firstSeen: now, snapshot: t }])),
    };
    saveBaseline(pinDir, baseline);
    return [];
  }
  const drift = diffTools(existing, live.tools);
  // A pin is not moved forward on drift: the change stays reported until someone re-approves it
  // (deletes the pin file) instead of being trusted silently on the next run.
  const added = live.tools.filter((t) => !existing.tools[t.name]);
  if (added.length > 0) {
    for (const tool of added) existing.tools[tool.name] = { hash: hashTool(tool), firstSeen: now, snapshot: tool };
    saveBaseline(pinDir, existing);
  }
  const findings: NormalizedFinding[] = [];
  pushNormalized(
    findings,
    drift.map((d) => ({
      patternId: d.patternId,
      patternName: `${label}: ${d.patternName}`,
      severity: d.severity,
      owasp: "MCP03:2025",
      recommendation: `${d.recommendation} Pins: ${pinDir}/${serverId}.json (delete it to re-approve the current definitions).`,
      match: d.detail,
      tools: [`${label}/${d.toolName}`],
    })),
    "rug-pull"
  );
  return findings;
}

/** Findings whose tools come from two or more servers are the ones no single-server scan can see. */
function serversOf(tools: string[] | undefined): Set<string> {
  return new Set((tools ?? []).map((t) => t.slice(0, t.indexOf("/"))));
}

/**
 * Find every MCP server configured in this machine's clients, connect to each
 * (remote servers always, local ones only with `runStdio`), and audit what
 * they expose: tool poisoning and toxic flows per server, tool shadowing and
 * toxic flows across servers, Shadow MCP against an allowlist, and tool
 * definitions that changed since the last run.
 */
export async function scanInstalled(options: InstalledScanOptions = {}): Promise<OwaspReport> {
  const start = Date.now();
  const allowlist = options.allowlist ?? (options.allowlistPath ? loadAllowlistFile(options.allowlistPath) : null);
  const timeoutMs = options.timeoutMs ?? 15000;
  const connect = options.connect ?? connectAndListTools;
  const pinDir = options.pinDir === false ? null : (options.pinDir ?? DEFAULT_PIN_DIR);
  const findings: NormalizedFinding[] = [];

  const discovered = discoverShadowMcp({ allowlist, paths: options.paths, home: options.home });
  pushNormalized(
    findings,
    discovered.findings.map((f) => ({
      patternId: f.patternId,
      patternName: f.patternName,
      severity: f.severity,
      owasp: f.owasp,
      recommendation: f.recommendation,
      file: f.file,
      line: f.line,
      column: f.column,
      match: f.match,
    })),
    "config-discover"
  );

  const candidates = new Map<string, Candidate>();
  for (const group of discovered.discovered) {
    for (const server of group.servers) {
      const key = identity(server);
      const candidate = candidates.get(key) ?? { key, server, clients: [], configPaths: [] };
      if (!candidate.clients.includes(group.client)) candidate.clients.push(group.client);
      if (!candidate.configPaths.includes(group.path)) candidate.configPaths.push(group.path);
      // A server enabled in any client is live on this machine
      if (candidate.server.disabled && !server.disabled) candidate.server = server;
      candidates.set(key, candidate);
    }
  }

  const servers: InstalledServer[] = [];
  const catalogs: Array<{ name: string; tools: LiveTool[] }> = [];
  const usedNames = new Set<string>();

  for (const candidate of candidates.values()) {
    const { server } = candidate;
    const connection = target(server);
    const entry: InstalledServer = {
      clients: candidate.clients,
      configPaths: candidate.configPaths,
      name: server.name,
      transport: server.url ? "http" : "stdio",
      status: "skipped",
    };
    servers.push(entry);

    if (server.disabled) {
      entry.reason = "disabled in the client config";
      continue;
    }
    if (!connection) {
      entry.status = "error";
      entry.reason = "no command or url in the config";
      continue;
    }
    if (connection.type === "stdio" && !options.runStdio) {
      entry.reason = "local server not started (pass --run-stdio to start it and read its tools)";
      continue;
    }

    let live: LiveServerInfo;
    try {
      live = await connect(connection, timeoutMs);
    } catch (err) {
      entry.status = "error";
      entry.reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      continue;
    }
    entry.status = "scanned";
    entry.toolCount = live.tools.length;
    if (live.serverInfo) entry.serverInfo = live.serverInfo;

    // Two configs may use the same key for different servers: keep labels unique so findings stay attributable
    let label = server.name;
    for (let n = 2; usedNames.has(label); n++) label = `${server.name}#${n}`;
    usedNames.add(label);

    for (const finding of catalogFindings(live.tools, label)) {
      findings.push({
        ...finding,
        patternName: `${label}: ${finding.patternName}`,
        tools: finding.tools?.map((tool) => `${label}/${tool}`),
      });
    }
    if (pinDir) {
      const drift = checkPins(pinDir, candidate.key, label, live);
      if (drift.length > 0) entry.drift = drift.length;
      findings.push(...drift);
    }
    catalogs.push({ name: label, tools: live.tools });
  }

  if (catalogs.length > 1) {
    pushNormalized(
      findings,
      scanInventory(catalogs.map((c) => ({ name: c.name, tools: c.tools.map((t) => ({ name: t.name, description: t.description })) }))).map((f) => ({
        patternId: f.patternId,
        patternName: f.patternName,
        severity: f.severity,
        owasp: f.owasp,
        recommendation: f.recommendation,
        match: f.match,
        tools: f.server?.split(", "),
      })),
      "tool-shadowing"
    );

    // The agent sees every installed server's tools at once: a trifecta can be split across servers
    const combined = catalogs.flatMap((c) => c.tools.map((t) => ({ ...t, name: `${c.name}/${t.name}` })));
    const perServer = new Set(findings.filter((f) => f.source === "toxic-flow").map((f) => f.patternId));
    const cross = auditCatalog(combined, "installed servers").findings.filter(
      (f) => !perServer.has(f.patternId) && serversOf(f.tools).size > 1
    );
    pushNormalized(
      findings,
      cross.map((f) => {
        const names = [...serversOf(f.tools)];
        return {
          patternId: `cross_server_${f.patternId}`,
          patternName: `Across servers ${names.join(", ")}: ${f.patternName}`,
          severity: f.severity,
          owasp: f.owasp,
          recommendation: `No single server has this combination, but an agent with ${names.join(", ")} connected at once does. Do not enable these servers in the same client or profile, or put an approval gate (for example the GuardBee proxy) on the outbound tools. ${f.recommendation}`,
          match: f.match,
          tools: f.tools,
        };
      }),
      "toxic-flow"
    );
  }

  const scanned = servers.filter((s) => s.status === "scanned");
  const report = buildReport("installed", `${scanned.length}/${servers.length} installed MCP server(s) scanned`, findings, start, {
    scannedFiles: discovered.scannedFiles,
    toolCount: scanned.reduce((sum, s) => sum + (s.toolCount ?? 0), 0),
    servers,
  });
  return report;
}
