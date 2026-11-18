import { execFileSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { resolvePaths, type ClaudePaths } from "./paths.js";

/** A Claude Code process registered under <claudeDir>/sessions/<pid>.json. */
export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  /** interactive, background, ... */
  kind: string;
  /** cli, claude-vscode, sdk-ts, ... */
  entrypoint: string;
  /** busy or idle, as Claude Code last reported it */
  status: string;
  startedAt: number;
  updatedAt: number;
  alive: boolean;
}

export interface RemoteLogin {
  user: string;
  tty: string;
  host: string;
  since: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function listLiveSessions(paths?: Partial<ClaudePaths>, alive: (pid: number) => boolean = isAlive): LiveSession[] {
  const dir = join(resolvePaths(paths).claudeDir, "sessions");
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return [];
  }
  const sessions: LiveSession[] = [];
  for (const name of names) {
    try {
      const s = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
      const pid = Number(s.pid);
      if (!Number.isInteger(pid)) continue;
      sessions.push({
        pid,
        sessionId: String(s.sessionId ?? ""),
        cwd: String(s.cwd ?? ""),
        kind: String(s.kind ?? "unknown"),
        entrypoint: String(s.entrypoint ?? "unknown"),
        status: String(s.status ?? "unknown"),
        startedAt: Number(s.startedAt ?? 0),
        updatedAt: Number(s.updatedAt ?? 0),
        alive: alive(pid),
      });
    } catch {
      // being rewritten
    }
  }
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}

/** Lines of `who` that carry a remote host in parentheses: someone logged in over SSH or similar. */
export function parseWho(output: string): RemoteLogin[] {
  const logins: RemoteLogin[] = [];
  for (const raw of output.split("\n")) {
    // Split by hand: a backtracking regex over `who` output is polynomial on long runs of spaces
    const line = raw.trimEnd();
    if (!line.endsWith(")")) continue;
    const open = line.lastIndexOf(" (");
    if (open === -1) continue;
    const host = line.slice(open + 2, -1);
    const fields = line.slice(0, open).split(/\s+/).filter(Boolean);
    if (fields.length < 3 || !host) continue;
    // tmux/screen record a local pane (":0", "tmux(1234).%0") here, not a remote host
    if (/^:\d|^tmux|^screen|^localhost$|^127\.0\.0\.1$|^::1$/.test(host)) continue;
    logins.push({ user: fields[0], tty: fields[1], since: fields.slice(2).join(" "), host });
  }
  return logins;
}

export function remoteLogins(): RemoteLogin[] {
  if (process.platform === "win32") return [];
  try {
    return parseWho(execFileSync("who", [], { encoding: "utf8", timeout: 3000 }));
  } catch {
    return [];
  }
}
