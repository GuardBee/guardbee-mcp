import fs from "fs";
import os from "os";
import path from "path";
import { stringify as toYaml } from "yaml";
import { gradeBelow, lookupMcpGrade, parseLaunch, type McpGrade, type McpIndex } from "@guardbee/guard-core";
import type { UpstreamConfig } from "./types.js";
import type { SandboxConfig, SandboxRuntime } from "./gateway/sandbox.js";

export type ClientName = "claude-desktop" | "cursor" | "claude-code";

/** Where each client keeps its user-level MCP config. */
export function clientConfigPath(client: ClientName, platform = process.platform, home = os.homedir()): string {
  switch (client) {
    case "claude-desktop":
      if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      if (platform === "win32") return path.join(process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      return path.join(home, ".config", "Claude", "claude_desktop_config.json");
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "claude-code":
      return path.join(home, ".claude.json");
  }
}

export interface InitPlan {
  /** guardbee-proxy.yaml contents. */
  yaml: string;
  /** The client config rewritten to launch the proxy. */
  clientConfig: string;
  /** Server entries moved behind the proxy: config key → upstream name. */
  migrated: Record<string, string>;
  /** Entries left in the client config, and why. */
  kept: { name: string; reason: string }[];
  /** GuardBee MCP Index grade of each moved server (with `grades`). */
  graded: { name: string; grade: McpGrade | null; note: string }[];
  /** Servers below `minGrade`: neither moved nor left in the client config (the backup still has them). */
  blocked: { name: string; reason: string }[];
}

export interface InitGrades {
  index: McpIndex;
  /** Leave out servers graded below this. */
  minGrade?: McpGrade;
}

function gradeOf(grades: InitGrades, command: string | undefined, args: string[] | undefined, url: string | undefined): { grade: McpGrade | null; note: string } {
  if (url) return { grade: null, note: "remote server: the index grades published packages" };
  const target = command ? parseLaunch(command, args ?? []) : undefined;
  if (!target) return { grade: null, note: "local command: not a registry package" };
  const match = lookupMcpGrade(grades.index, target);
  if (!match) return { grade: null, note: "not in the MCP Index" };
  if (match.entry.grade === null) return { grade: null, note: match.entry.note ?? "not graded" };
  return { grade: match.entry.grade, note: `${match.entry.name}, ${match.entry.score}/100 (${match.package.identifier}@${match.package.version ?? "?"})` };
}

const PROXY_PACKAGE = "@guardbee/mcp-security-proxy";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isProxyEntry(entry: Record<string, unknown>): boolean {
  const words = [entry["command"], ...(Array.isArray(entry["args"]) ? entry["args"] : [])].map(String);
  return words.some((word) => word.includes(PROXY_PACKAGE) || /(^|[/\\])guardbee-proxy(\.cmd)?$/.test(word));
}

/** Config keys become upstream names: letters, digits, - and single _. */
function upstreamName(key: string, taken: Set<string>): string {
  const base =
    key
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/_{2,}/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "") || "server";
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  taken.add(name);
  return name;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const out = Object.fromEntries(
    Object.entries(rec).flatMap(([k, v]) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? [[k, String(v)]] : [])),
  );
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Work out the migration without touching the disk. stdio and Streamable HTTP
 * servers move into the YAML; SSE servers, disabled entries and an existing
 * proxy entry stay.
 */
/** The sandbox runtime `init --sandbox` uses when none is named: the one this OS has built in, else a container. */
export function defaultSandboxRuntime(platform = process.platform, pathEnv = process.env["PATH"] ?? ""): SandboxRuntime {
  if (platform === "darwin") return "sandbox-exec";
  if (platform === "linux" && pathEnv.split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, "bwrap")))) return "bwrap";
  return "docker";
}

/** Directory arguments (a filesystem server's roots) become writable paths; the rest of the disk stays read-only. */
function sandboxFor(command: string, args: string[] | undefined, runtime: SandboxRuntime, home: string): Record<string, unknown> | undefined {
  if (/(^|[/\\])(docker|podman)(\.exe)?$/.test(command)) return undefined; // already a container
  const dirs = (args ?? []).filter((arg) => {
    if (!/^(\/|~\/|\.{1,2}\/|[A-Za-z]:\\)/.test(arg)) return false;
    const resolved = arg.startsWith("~/") ? path.join(home, arg.slice(2)) : path.resolve(arg);
    try {
      return fs.statSync(resolved).isDirectory() && resolved !== home && resolved !== path.parse(resolved).root;
    } catch {
      return false;
    }
  });
  return { runtime, ...(dirs.length ? { fs: { readWrite: dirs } } : {}) };
}

export function planInit(clientConfigText: string, yamlPath: string, auditPath: string, options: { sandbox?: SandboxRuntime; home?: string; grades?: InitGrades } = {}): InitPlan {
  const root = asRecord(JSON.parse(clientConfigText));
  if (!root) throw new Error("The client config is not a JSON object");
  const servers = asRecord(root["mcpServers"]);
  if (!servers || Object.keys(servers).length === 0) throw new Error("No mcpServers found in the client config");

  const upstreams: Record<string, UpstreamConfig> = {};
  const migrated: Record<string, string> = {};
  const kept: InitPlan["kept"] = [];
  const graded: InitPlan["graded"] = [];
  const blocked: InitPlan["blocked"] = [];
  /** With grades: record the grade; false when the server is below the minimum and must not be moved. */
  const admit = (key: string, command: string | undefined, args: string[] | undefined, url: string | undefined): boolean => {
    if (!options.grades) return true;
    const { grade, note } = gradeOf(options.grades, command, args, url);
    graded.push({ name: key, grade, note });
    const minimum = options.grades.minGrade;
    if (grade && minimum && gradeBelow(grade, minimum)) {
      blocked.push({ name: key, reason: `MCP Index grade ${grade} is below --min-grade ${minimum} (${note})` });
      return false;
    }
    return true;
  };
  const remaining: Record<string, unknown> = {};
  const taken = new Set<string>();

  for (const [key, value] of Object.entries(servers)) {
    const entry = asRecord(value);
    if (!entry) {
      remaining[key] = value;
      kept.push({ name: key, reason: "not an object" });
    } else if (isProxyEntry(entry)) {
      remaining[key] = value;
      kept.push({ name: key, reason: "already the GuardBee proxy" });
    } else if (entry["disabled"] === true) {
      remaining[key] = value;
      kept.push({ name: key, reason: "disabled" });
    } else if (typeof entry["command"] !== "string") {
      const url = typeof entry["url"] === "string" ? entry["url"] : typeof entry["serverUrl"] === "string" ? entry["serverUrl"] : undefined;
      if (!url || entry["type"] === "sse") {
        remaining[key] = value;
        kept.push({
          name: key,
          reason: url
            ? `SSE server: the proxy speaks Streamable HTTP only, so this one bypasses the policy${
                /\/sse\/?(?:[?#]|$)/.test(url) ? "; many servers (Cloudflare's among them) now serve it at /mcp instead of /sse" : ""
              }`
            : "no command or url",
        });
      } else if (admit(key, undefined, undefined, url)) {
        const name = upstreamName(key, taken);
        const headers = stringRecord(entry["headers"]);
        upstreams[name] = { url, ...(headers ? { headers } : {}) };
        migrated[key] = name;
      }
    } else if (admit(key, entry["command"], Array.isArray(entry["args"]) ? entry["args"].map(String) : undefined, undefined)) {
      const name = upstreamName(key, taken);
      const args = Array.isArray(entry["args"]) ? entry["args"].map(String) : undefined;
      const env = stringRecord(entry["env"]);
      const sandbox = options.sandbox ? sandboxFor(entry["command"], args, options.sandbox, options.home ?? os.homedir()) : undefined;
      upstreams[name] = { command: entry["command"], ...(args?.length ? { args } : {}), ...(env ? { env } : {}), ...(sandbox ? { sandbox: sandbox as unknown as SandboxConfig } : {}) };
      migrated[key] = name;
    }
  }
  if (Object.keys(upstreams).length === 0) throw new Error("No MCP servers to move behind the proxy");

  const proxyKey = !("guardbee" in remaining) ? "guardbee" : "guardbee-gateway";
  // Pinned to 1.x: 0.x does not understand --config and would fail to start.
  remaining[proxyKey] = { command: "npx", args: ["-y", `${PROXY_PACKAGE}@^1`, "--config", yamlPath] };

  const yaml =
    "# GuardBee MCP gateway — generated by `guardbee-proxy init`.\n" +
    "# Tools appear to the agent as <upstream>__<tool>. Check a change with `guardbee-proxy validate --config <this file>`.\n" +
    "# env and header values were copied from the client config; move secrets to ${VAR} references where you can.\n" +
    (options.sandbox
      ? `# stdio servers run in a ${options.sandbox} sandbox: read-only disk, credentials hidden, no host environment.\n` +
        "# List what a server needs under sandbox.fs.readWrite and sandbox.env; check with `guardbee-proxy validate`.\n"
      : "") +
    toYaml({
      version: 1,
      upstreams,
      taint: { mode: "strict" },
      audit: { sink: "file", filePath: auditPath },
    });

  return {
    yaml,
    clientConfig: JSON.stringify({ ...root, mcpServers: remaining }, null, 2) + "\n",
    migrated,
    kept,
    graded,
    blocked,
  };
}

export interface InitOptions {
  clientConfigPath: string;
  yamlPath: string;
  dryRun?: boolean;
  force?: boolean;
  now?: Date;
  /** Put stdio servers in this sandbox runtime. */
  sandbox?: SandboxRuntime;
  /** Show MCP Index grades; leave out servers below minGrade. */
  grades?: InitGrades;
}

export interface InitResult extends InitPlan {
  backupPath?: string;
}

/** Write the YAML (mode 0600, it may hold tokens), back up the client config, then rewrite it. */
export function runInit(options: InitOptions): InitResult {
  const clientPath = path.resolve(options.clientConfigPath);
  const yamlPath = path.resolve(options.yamlPath);
  const auditPath = path.join(path.dirname(yamlPath), "guardbee-audit.jsonl");
  if (!fs.existsSync(clientPath)) throw new Error(`Client config not found: ${clientPath}`);
  if (fs.existsSync(yamlPath) && !options.force && !options.dryRun) {
    throw new Error(`${yamlPath} already exists; pass --force to overwrite it`);
  }

  const plan = planInit(fs.readFileSync(clientPath, "utf8"), yamlPath, auditPath, { ...(options.sandbox ? { sandbox: options.sandbox } : {}), ...(options.grades ? { grades: options.grades } : {}) });
  if (options.dryRun) return plan;

  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupPath = `${clientPath}.guardbee-backup-${stamp}`;
  fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
  fs.writeFileSync(yamlPath, plan.yaml, { mode: 0o600 });
  fs.chmodSync(yamlPath, 0o600); // `mode` only applies when the file is created; --force may overwrite a wider one

  fs.copyFileSync(clientPath, backupPath);
  fs.writeFileSync(clientPath, plan.clientConfig);
  return { ...plan, backupPath };
}
