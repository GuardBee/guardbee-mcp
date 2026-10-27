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
 * - `network: none` cuts all network access.
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
  network: "none" | "open";
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

export interface Launch {
  command: string;
  args: string[];
  /** The environment of the launched process (the container client's, for docker and podman). */
  env: Record<string, string>;
}

const base = (command: string) => command.split(/[\\/]/).pop()!.replace(/\.(cmd|exe)$/i, "");

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
function sandboxEnv(server: McpServerConfig, sandbox: SandboxConfig, ctx: SandboxContext, home: string): Record<string, string> {
  const env: Record<string, string> = { HOME: home, TMPDIR: path.join(home, "tmp") };
  for (const name of ["PATH", "LANG", "LC_ALL", "TERM", "TZ"]) if (ctx.env[name] !== undefined) env[name] = ctx.env[name]!;
  for (const name of sandbox.env) if (ctx.env[name] !== undefined) env[name] = ctx.env[name]!;
  return { ...env, ...(server.env ?? {}) };
}

const sbString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A Seatbelt profile (macOS sandbox-exec) for this sandbox. */
export function seatbeltProfile(sandbox: SandboxConfig, ctx: SandboxContext, home: string): string {
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
    // No talking to other processes' sockets (docker.sock, ssh-agent) even with network open
    "(deny network-outbound (remote unix-socket))",
    // …except the system resolver, which answers DNS over a unix socket on macOS
    ...(sandbox.network === "open" ? ['(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))'] : []),
    "",
  ].join("\n");
}

/** How to start `server` inside `sandbox`. `runtime: none` returns the command as it is. */
export function sandboxLaunch(server: McpServerConfig, sandbox: SandboxConfig, ctx: SandboxContext): Launch {
  const args = server.args ?? [];
  const home = sandboxHome(ctx);
  if (sandbox.runtime === "none") {
    return { command: server.command, args, env: { ...(ctx.env as Record<string, string>), ...(server.env ?? {}) } };
  }
  fs.mkdirSync(path.join(home, "tmp"), { recursive: true, mode: 0o700 });
  const env = sandboxEnv(server, sandbox, ctx, home);
  const readOnly = sandbox.fs.readOnly.map((p) => expand(p, ctx));
  const readWrite = sandbox.fs.readWrite.map((p) => expand(p, ctx));
  const denied = deniedPaths(sandbox, ctx);

  if (sandbox.runtime === "sandbox-exec") {
    const profile = path.join(home, "sandbox.sb");
    fs.writeFileSync(profile, seatbeltProfile(sandbox, ctx, home), { mode: 0o600 });
    return { command: "sandbox-exec", args: ["-f", profile, server.command, ...args], env };
  }

  if (sandbox.runtime === "bwrap") {
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
    out.push("--chdir", ctx.cwd, "--", server.command, ...args);
    return { command: "bwrap", args: out, env };
  }

  // docker / podman: nothing of the host is visible unless mounted
  const containerHome = "/sandbox-home";
  const out = ["run", "-i", "--rm", "--init", "--name", `guardbee-${ctx.name.replace(/[^\w.-]/g, "_")}-${process.pid}`];
  out.push("--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges");
  out.push("--network", sandbox.network === "none" ? "none" : "bridge");
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
  return { command: sandbox.runtime, args: out, env: clientEnv };
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
