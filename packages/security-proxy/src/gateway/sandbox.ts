import fs from "fs";
import os from "os";
import path from "path";
import type { McpServerConfig } from "../types.js";

/**
 * Run a stdio upstream in an OS sandbox instead of as a plain child process
 * with the proxy user's privileges. Every runtime gives the same contract:
 *
 * - the file system is read-only, except `fs.readWrite` and a private home
 *   (~/.guardbee/sandbox/<name>) that holds the package manager's cache;
 * - credential stores (~/.ssh, cloud CLIs, browser profiles, `.env` files…)
 *   and `fs.deny` cannot be read;
 * - no host environment variable is passed unless listed in `env`
 *   (the upstream's own `env` values always are);
 * - `network: none` cuts all network access; `network: allowlist` leaves only
 *   the gateway's egress proxy (egress.ts), which connects to `allowHosts`
 *   and nothing else.
 *
 * Containers (docker, podman) also take CPU, memory and process limits.
 */
export type SandboxRuntime = "none" | "docker" | "podman" | "bwrap" | "sandbox-exec";

export interface SandboxConfig {
  runtime: SandboxRuntime;
  /** Container image (docker, podman); derived from the command when unset (node, uv, bun). */
  image?: string;
  fs: {
    /** Visible read-only. Containers see only these and readWrite; the other runtimes see the whole file system read-only. */
    readOnly: string[];
    readWrite: string[];
    /** Hidden on top of the credential paths. */
    deny: string[];
  };
  /** Host environment variables passed in, by name. */
  env: string[];
  network: "none" | "open" | "allowlist";
  /** network: allowlist — host names or globs the server may reach, through the egress proxy. */
  allowHosts?: string[];
  /** network: allowlist — also refuse loopback and private addresses (default true). Metadata and link-local are always refused. */
  blockPrivate?: boolean;
  limits?: { cpus?: number; memory?: string; pids?: number };
}

/** Credential and profile stores, relative to the home directory: never readable inside a sandbox. */
export const CREDENTIAL_PATHS = [
  ".ssh",
  ".aws",
  ".azure",
  ".config/gcloud",
  ".kube",
  ".docker",
  ".gnupg",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".config/gh",
  ".password-store",
  ".vault-token",
  ".terraform.d",
  ".mozilla",
  ".config/google-chrome",
  ".config/chromium",
  ".config/BraveSoftware",
  "Library/Keychains",
  "Library/Cookies",
  "Library/Safari",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Firefox",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge",
  ".guardbee/pins.json",
  ".guardbee/provenance.json",
];

/** Matches `.env`, `.env.local`, … at any depth. */
const DOTENV = /(^|\/)\.env(\.[^/]*)?$/;

export interface SandboxContext {
  /** Upstream name: names the private home directory and the container. */
  name: string;
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  /** Directory of the private homes; default ~/.guardbee/sandbox. */
  stateDir?: string;
}

export function sandboxContext(name: string): SandboxContext {
  return {
    name,
    cwd: process.cwd(),
    home: os.homedir(),
    platform: process.platform,
    env: process.env,
    ...(typeof process.getuid === "function" ? { uid: process.getuid() } : {}),
    ...(typeof process.getgid === "function" ? { gid: process.getgid() } : {}),
  };
}

/** Where the gateway's egress proxy for this sandbox listens (network: allowlist). */
export interface EgressEndpoint {
  /** TCP port on the host's 127.0.0.1 (sandbox-exec; docker and podman outside Linux). */
  port?: number;
  /** Unix socket (bwrap; docker and podman on Linux). */
  socket?: string;
}

/** The directory of the egress socket and helper scripts, inside the private home. */
export const egressDir = (home: string) => path.join(home, "egress");

/** The port the in-sandbox forwarder listens on (its own network namespace or container). */
const INNER_PROXY_PORT = 3128;

/** Proxy settings every common client reads: curl, Node (NODE_USE_ENV_PROXY), npm, pip / uv, Go, Deno, Bun. */
export function proxyEnv(url: string): Record<string, string> {
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    NODE_USE_ENV_PROXY: "1",
    npm_config_proxy: url,
    npm_config_https_proxy: url,
  };
}

/**
 * Forwards TCP from a local listener to the egress proxy (a unix socket or
 * host:port), then optionally runs a command. Inside bwrap it gives the
 * server a 127.0.0.1 proxy in a network namespace that has nothing else; in
 * the docker / podman sidecar it bridges the internal network to the gateway.
 */
export const FORWARDER_SCRIPT = `// GuardBee sandbox egress forwarder (generated)
import net from "node:net";
import { spawn } from "node:child_process";
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const opts = sep < 0 ? argv : argv.slice(0, sep);
const value = (flag) => opts[opts.indexOf(flag) + 1];
const [lhost, lport] = value("--listen").split(/:(?=\\d+$)/);
const to = value("--to");
const target = to.startsWith("/") ? { path: to } : { host: to.slice(0, to.lastIndexOf(":")), port: Number(to.slice(to.lastIndexOf(":") + 1)) };
const server = net.createServer((client) => {
  const upstream = net.connect(target);
  client.pipe(upstream).pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
});
server.listen(Number(lport), lhost, () => {
  if (sep < 0) return;
  const child = spawn(argv[sep + 1], argv.slice(sep + 2), { stdio: "inherit" });
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  child.on("error", (err) => { process.stderr.write(String(err) + "\\n"); process.exit(127); });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
});
`;

/**
 * docker / podman with network: allowlist. Puts the server container on an
 * --internal network (no route out) together with a forwarder sidecar that is
 * also on the default network and forwards to the gateway's egress proxy;
 * runs the server with stdio attached and removes all three on exit.
 */
export const CONTAINER_LAUNCHER_SCRIPT = `// GuardBee sandbox container launcher (generated)
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const run = (args) => spawnSync(spec.runtime, args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
const cleanup = () => {
  run(["rm", "-f", spec.container, spec.sidecar]);
  run(["network", "rm", spec.network]);
};
const fail = (step, result) => {
  process.stderr.write("[guardbee-sandbox] " + step + " failed: " + (result.stderr || result.error || "").toString().trim() + "\\n");
  cleanup();
  process.exit(1);
};
cleanup();
let result = run(["network", "create", "--internal", spec.network]);
if (result.status !== 0) fail("network create", result);
result = run(["run", "-d", "--rm", "--name", spec.sidecar, ...spec.sidecarArgs]);
if (result.status !== 0) fail("egress sidecar", result);
result = run(["network", "connect", "--alias", "egress", spec.network, spec.sidecar]);
if (result.status !== 0) fail("network connect", result);
const child = spawn(spec.runtime, spec.serverArgs, { stdio: "inherit" });
let done = false;
const finish = (code) => {
  if (done) return;
  done = true;
  cleanup();
  process.exit(code);
};
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => { child.kill(signal); finish(143); });
child.on("error", () => finish(127));
child.on("exit", (code, signal) => finish(code ?? (signal ? 128 : 1)));
`;

export interface Launch {
  command: string;
  args: string[];
  /** The environment of the launched process (the container client's, for docker and podman). */
  env: Record<string, string>;
}

const base = (command: string) => command.split(/[\\/]/).pop()!.replace(/\.(cmd|exe)$/i, "");

/** The egress forwarder sidecar's image (docker, podman with network: allowlist). */
export const SIDECAR_IMAGE = "node:22-alpine";

/** How the gateway's egress proxy listens for this sandbox: a unix socket where the sandbox can reach one, a loopback port otherwise. */
export function egressListen(sandbox: SandboxConfig, ctx: SandboxContext): { tcp: true } | { socket: string } {
  const container = sandbox.runtime === "docker" || sandbox.runtime === "podman";
  // Docker Desktop and podman machine do not carry unix sockets through bind mounts (ENOTSUP)
  if (sandbox.runtime === "bwrap" || (container && ctx.platform === "linux")) return { socket: path.join(egressDir(sandboxHome(ctx)), "proxy.sock") };
  return { tcp: true };
}

/** An image that has the command, for the package runners servers are usually started with. */
export function defaultImage(command: string): string | undefined {
  const cmd = base(command);
  if (["node", "npx", "npm", "pnpm", "corepack"].includes(cmd)) return "node:22-alpine";
  if (["uvx", "uv", "python", "python3", "pip"].includes(cmd)) return "ghcr.io/astral-sh/uv:python3.12-alpine";
  if (["bun", "bunx"].includes(cmd)) return "oven/bun:1-alpine";
  if (cmd === "deno") return "denoland/deno:alpine";
  return undefined;
}

const expand = (p: string, ctx: SandboxContext) => path.resolve(ctx.cwd, p.startsWith("~/") ? path.join(ctx.home, p.slice(2)) : p === "~" ? ctx.home : p);

/** The real path where it exists (sandbox-exec matches resolved paths: /tmp is /private/tmp). */
function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

export function sandboxHome(ctx: SandboxContext): string {
  return path.join(ctx.stateDir ?? path.join(ctx.home, ".guardbee", "sandbox"), ctx.name.replace(/[^\w.-]/g, "_"));
}

/** The paths no sandbox may read: credential stores and fs.deny, absolute. */
function deniedPaths(sandbox: SandboxConfig, ctx: SandboxContext): string[] {
  return [...CREDENTIAL_PATHS.map((p) => path.join(ctx.home, p)), ...sandbox.fs.deny.map((p) => expand(p, ctx))];
}

/** `.env` files directly in these directories (bwrap and containers hide files one by one). */
function dotenvFiles(dirs: string[]): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) if (entry.isFile() && DOTENV.test(entry.name)) found.push(path.join(dir, entry.name));
  }
  return found;
}

/** Environment inside the sandbox: a minimal base, the allowlisted host variables, and the upstream's own. */
function sandboxEnv(server: McpServerConfig, sandbox: SandboxConfig, ctx: SandboxContext, home: string, proxy?: string): Record<string, string> {
  const env: Record<string, string> = { HOME: home, TMPDIR: path.join(home, "tmp") };
  for (const name of ["PATH", "LANG", "LC_ALL", "TERM", "TZ"]) if (ctx.env[name] !== undefined) env[name] = ctx.env[name]!;
  for (const name of sandbox.env) if (ctx.env[name] !== undefined) env[name] = ctx.env[name]!;
  // The proxy settings come last: neither the host nor the upstream's env can point around the egress proxy
  return { ...env, ...(server.env ?? {}), ...(proxy ? proxyEnv(proxy) : {}) };
}

const sbString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A Seatbelt profile (macOS sandbox-exec) for this sandbox. */
export function seatbeltProfile(sandbox: SandboxConfig, ctx: SandboxContext, home: string, egress?: EgressEndpoint): string {
  // Temporary files go to the private home (TMPDIR): the shared temp directories stay read-only
  const writable = [home, ...sandbox.fs.readWrite.map((p) => expand(p, ctx))].map(real);
  const denied = deniedPaths(sandbox, ctx).map(real);
  return [
    "(version 1)",
    "(allow default)",
    // Writes only where allowed
    `(deny file-write* (require-not (require-any ${[...writable.map((p) => `(subpath ${sbString(p)})`), '(literal "/dev/null")', '(literal "/dev/zero")', '(regex #"^/dev/(tty|fd/|stdout$|stderr$|dtracehelper$)")'].join(" ")})))`,
    // Credentials neither read nor written; last match wins, so this comes after the allowances
    `(deny file-read* file-write* ${denied.map((p) => `(subpath ${sbString(p)})`).join(" ")} (regex #"/\\.env(\\.[^/]*)?$"))`,
    ...(sandbox.network === "none" ? ["(deny network*)"] : []),
    // allowlist: the egress proxy's port on the host loopback is the only destination
    ...(sandbox.network === "allowlist" ? ["(deny network*)", `(allow network-outbound (remote ip "localhost:${egress?.port ?? 0}"))`] : []),
    // No talking to other processes' sockets (docker.sock, ssh-agent) even with network open
    "(deny network-outbound (remote unix-socket))",
    // …except the system resolver, which answers DNS over a unix socket on macOS
    ...(sandbox.network === "open" ? ['(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))'] : []),
    "",
  ].join("\n");
}

/** How to start `server` inside `sandbox`. `runtime: none` returns the command as it is. */
/**
 * How to start `server` inside `sandbox`. `runtime: none` returns the command
 * as it is. With `network: allowlist`, `egress` is where the gateway's egress
 * proxy listens (a socket for bwrap and Linux containers, a port otherwise;
 * see egressListen).
 */
export function sandboxLaunch(server: McpServerConfig, sandbox: SandboxConfig, ctx: SandboxContext, egress?: EgressEndpoint): Launch {
  const args = server.args ?? [];
  const home = sandboxHome(ctx);
  if (sandbox.runtime === "none") {
    return { command: server.command, args, env: { ...(ctx.env as Record<string, string>), ...(server.env ?? {}) } };
  }
  fs.mkdirSync(path.join(home, "tmp"), { recursive: true, mode: 0o700 });
  const allowlist = sandbox.network === "allowlist";
  if (allowlist && !egress?.port && !egress?.socket) throw new Error("network: allowlist needs the egress proxy to be started first");
  const container = sandbox.runtime === "docker" || sandbox.runtime === "podman";
  const proxyUrl = !allowlist
    ? undefined
    : sandbox.runtime === "sandbox-exec"
      ? `http://127.0.0.1:${egress!.port}`
      : container
        ? `http://egress:${INNER_PROXY_PORT}`
        : `http://127.0.0.1:${INNER_PROXY_PORT}`;
  const env = sandboxEnv(server, sandbox, ctx, home, proxyUrl);
  if (allowlist) {
    fs.mkdirSync(egressDir(home), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(egressDir(home), "forward.mjs"), FORWARDER_SCRIPT, { mode: 0o644 });
  }
  const readOnly = sandbox.fs.readOnly.map((p) => expand(p, ctx));
  const readWrite = sandbox.fs.readWrite.map((p) => expand(p, ctx));
  const denied = deniedPaths(sandbox, ctx);

  if (sandbox.runtime === "sandbox-exec") {
    const profile = path.join(home, "sandbox.sb");
    fs.writeFileSync(profile, seatbeltProfile(sandbox, ctx, home, egress), { mode: 0o600 });
    return { command: "sandbox-exec", args: ["-f", profile, server.command, ...args], env };
  }

  if (sandbox.runtime === "bwrap") {
    // allowlist: a network namespace of its own (only loopback), where the forwarder relays to the egress socket
    const out = ["--die-with-parent", "--new-session", "--unshare-all", ...(sandbox.network === "open" ? ["--share-net"] : [])];
    out.push("--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--bind", home, home);
    for (const p of readWrite) out.push("--bind", p, p);
    // Hide credentials and .env files: an empty tmpfs over a directory, /dev/null over a file
    for (const p of [...denied, ...dotenvFiles([ctx.cwd, ...readOnly, ...readWrite])]) {
      if (!fs.existsSync(p)) continue;
      out.push(...(fs.statSync(p).isDirectory() ? ["--tmpfs", p] : ["--ro-bind", "/dev/null", p]));
    }
    out.push("--clearenv");
    for (const [key, value] of Object.entries(env)) out.push("--setenv", key, value);
    out.push("--chdir", ctx.cwd, "--");
    if (allowlist) out.push(process.execPath, path.join(egressDir(home), "forward.mjs"), "--listen", `127.0.0.1:${INNER_PROXY_PORT}`, "--to", egress!.socket!, "--");
    out.push(server.command, ...args);
    return { command: "bwrap", args: out, env };
  }

  // docker / podman: nothing of the host is visible unless mounted
  const containerHome = "/sandbox-home";
  const out = ["run", "-i", "--rm", "--init"];
  out.push("--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges");
  const containerName = `guardbee-${ctx.name.replace(/[^\w.-]/g, "_")}-${process.pid}`;
  const internalNetwork = `guardbee-net-${ctx.name.replace(/[^\w.-]/g, "_")}-${process.pid}`;
  out.push("--network", sandbox.network === "none" ? "none" : allowlist ? internalNetwork : "bridge");
  if (sandbox.limits?.cpus !== undefined) out.push("--cpus", String(sandbox.limits.cpus));
  if (sandbox.limits?.memory !== undefined) out.push("--memory", sandbox.limits.memory);
  if (sandbox.limits?.pids !== undefined) out.push("--pids-limit", String(sandbox.limits.pids));
  // Files written to mounts belong to the host user (Linux; Docker Desktop maps it on macOS)
  if (ctx.platform === "linux" && ctx.uid !== undefined) out.push("--user", `${ctx.uid}:${ctx.gid ?? ctx.uid}`);
  out.push("-v", `${home}:${containerHome}`, "-e", `HOME=${containerHome}`);
  for (const p of readOnly) out.push("-v", `${p}:${p}:ro`);
  for (const p of readWrite) out.push("-v", `${p}:${p}`);
  const mounted = [...readOnly, ...readWrite];
  for (const p of [...denied, ...dotenvFiles(mounted)]) {
    if (!mounted.some((m) => within(p, m)) || !fs.existsSync(p)) continue;
    out.push(...(fs.statSync(p).isDirectory() ? ["--tmpfs", p] : ["-v", `/dev/null:${p}:ro`]));
  }
  if (mounted.some((m) => within(ctx.cwd, m))) out.push("-w", ctx.cwd);
  // `-e NAME` takes the value from the client's environment: secrets stay out of the argument list (ps)
  const clientEnv: Record<string, string> = { ...(ctx.env as Record<string, string>) };
  for (const [key, value] of Object.entries(env)) {
    if (key === "HOME" || key === "PATH" || key === "TMPDIR") continue;
    clientEnv[key] = value;
    out.push("-e", key);
  }
  out.push(sandbox.image ?? defaultImage(server.command)!, server.command, ...args);
  out.splice(1, 0, "--name", containerName);
  if (!allowlist) return { command: sandbox.runtime, args: out, env: clientEnv };

  // The sidecar is the only member of the internal network with a route out, and it only forwards to the egress proxy
  const dir = egressDir(home);
  const sidecarArgs = ["--network", sandbox.runtime === "podman" ? "podman" : "bridge", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "64m", "--pids-limit", "32"];
  if (ctx.platform === "linux" && ctx.uid !== undefined) sidecarArgs.push("--user", `${ctx.uid}:${ctx.gid ?? ctx.uid}`);
  sidecarArgs.push("-v", `${dir}:/egress`);
  // Linux: the socket is shared through the mount; Docker Desktop / podman machine: the host's loopback through host.*.internal
  const to = egress!.socket ? `/egress/${path.basename(egress!.socket)}` : `${sandbox.runtime === "podman" ? "host.containers.internal" : "host.docker.internal"}:${egress!.port}`;
  sidecarArgs.push(SIDECAR_IMAGE, "node", "/egress/forward.mjs", "--listen", `0.0.0.0:${INNER_PROXY_PORT}`, "--to", to);
  const spec = {
    runtime: sandbox.runtime,
    network: internalNetwork,
    container: containerName,
    sidecar: `guardbee-egress-${ctx.name.replace(/[^\w.-]/g, "_")}-${process.pid}`,
    sidecarArgs,
    serverArgs: out,
  };
  fs.writeFileSync(path.join(dir, "launch.json"), JSON.stringify(spec, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "launch.mjs"), CONTAINER_LAUNCHER_SCRIPT, { mode: 0o644 });
  return { command: process.execPath, args: [path.join(dir, "launch.mjs"), path.join(dir, "launch.json")], env: clientEnv };
}

function onPath(binary: string, env: NodeJS.ProcessEnv): boolean {
  return (env["PATH"] ?? "").split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, binary)));
}

/** What is wrong with a sandbox on this host; empty when it can start. `guardbee-proxy validate` reports these. */
export function sandboxIssues(server: McpServerConfig, sandbox: SandboxConfig, ctx: SandboxContext): string[] {
  const issues: string[] = [];
  const { runtime } = sandbox;
  if (runtime === "none") return issues;
  if (runtime === "sandbox-exec" && ctx.platform !== "darwin") issues.push("sandbox-exec is macOS only: use bwrap on Linux, or docker / podman");
  if (runtime === "bwrap" && ctx.platform !== "linux") issues.push("bwrap (bubblewrap) is Linux only: use sandbox-exec on macOS, or docker / podman");
  if (!onPath(runtime, ctx.env)) issues.push(`${runtime} is not on PATH`);
  const container = runtime === "docker" || runtime === "podman";
  if (!container && sandbox.limits) issues.push(`limits need a container runtime (docker or podman); ${runtime} cannot apply them`);
  if (!container && sandbox.image) issues.push(`image is for docker or podman, not ${runtime}`);
  if (container && ["docker", "podman"].includes(base(server.command))) issues.push("the command already starts a container: put the flags on its own `run`, or run the server's command here instead");
  if (container && !sandbox.image && !defaultImage(server.command)) issues.push(`no default image for "${server.command}": set sandbox.image to one that has it`);
  const credentials = deniedPaths(sandbox, ctx);
  for (const [kind, list] of [["readOnly", sandbox.fs.readOnly], ["readWrite", sandbox.fs.readWrite]] as const) {
    for (const entry of list) {
      const p = expand(entry, ctx);
      if (!fs.existsSync(p)) issues.push(`fs.${kind}: ${entry} does not exist`);
      if (kind === "readWrite" && (p === path.parse(p).root || p === ctx.home)) issues.push(`fs.readWrite: ${entry} would make ${p === ctx.home ? "the home directory" : "the whole file system"} writable`);
      const exposed = credentials.find((c) => within(p, c));
      if (exposed) issues.push(`fs.${kind}: ${entry} is inside ${exposed}, which a sandbox never shows`);
    }
  }
  return issues;
}
