import { execFileSync } from "child_process";
import {
  contextSize,
  listLiveSessions,
  resolvePaths,
  scanTranscripts,
  weightedTokens,
  type ClaudePaths,
  type LiveSession,
} from "@guardbee/mcp-claude-usage-guard";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** ps elapsed time, [[dd-]hh:]mm:ss */
  elapsed: string;
  elapsedSeconds: number;
  cpu: number;
  tty: string;
  command: string;
}

/** A running Claude Code process, joined with what its session has been spending. */
export interface SessionInfo {
  pid: number;
  sessionId?: string;
  cwd?: string;
  entrypoint?: string;
  status?: string;
  tty: string;
  elapsedSeconds: number;
  cpu: number;
  /** Prompt size of the session's latest call: what every further message re-reads */
  currentContext: number;
  /** Cost-weighted tokens in the look-back window */
  recentWeighted: number;
  lastActivity?: number;
  /** This process runs (or is an ancestor of) the caller; never stopped */
  isSelf: boolean;
}

export function parseElapsed(etime: string): number {
  const [days, rest] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(days) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function parsePs(output: string): ProcessInfo[] {
  const rows: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    rows.push({ pid: +m[1], ppid: +m[2], elapsed: m[3], elapsedSeconds: parseElapsed(m[3]), cpu: +m[4], tty: m[5], command: m[6] });
  }
  return rows;
}

/** The Claude Code CLI binary, whether installed natively, via npm, or bundled in an IDE extension. */
export function isClaudeCommand(command: string): boolean {
  const exe = command.split(/\s+/)[0];
  return /(^|\/)claude$/.test(exe) || /\/@anthropic-ai\/claude-code\/cli\.js$/.test(command.split(/\s+/)[1] ?? "");
}

export function listProcesses(): ProcessInfo[] {
  if (process.platform === "win32") return [];
  try {
    return parsePs(execFileSync("ps", ["-axo", "pid=,ppid=,etime=,%cpu=,tty=,command="], { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024 }));
  } catch {
    return [];
  }
}

/** This process and its ancestors: the Claude Code session that launched this MCP server is among them. */
export function ancestorPids(processes: ProcessInfo[], pid = process.pid): Set<number> {
  const parent = new Map(processes.map((p) => [p.pid, p.ppid]));
  const chain = new Set<number>([pid]);
  let current = parent.get(pid);
  while (current && current > 1 && !chain.has(current)) {
    chain.add(current);
    current = parent.get(current);
  }
  return chain;
}

export interface ListOptions {
  paths?: Partial<ClaudePaths>;
  hours?: number;
  now?: number;
  processes?: ProcessInfo[];
  registry?: LiveSession[];
  selfPid?: number;
}

export function listSessions(options: ListOptions = {}): SessionInfo[] {
  const now = options.now ?? Date.now();
  const processes = options.processes ?? listProcesses();
  const registry = new Map((options.registry ?? listLiveSessions(options.paths)).map((s) => [s.pid, s]));
  const self = ancestorPids(processes, options.selfPid);
  const claude = processes.filter((p) => isClaudeCommand(p.command));

  const sessionIds = claude.map((p) => registry.get(p.pid)?.sessionId).filter((id): id is string => !!id);
  const since = now - (options.hours ?? 24) * 3_600_000;
  const latest = new Map<string, { ctx: number; ts: number }>();
  const recent = new Map<string, number>();
  if (sessionIds.length) {
    // Context size needs each session's latest call since it started, which may predate the window
    const wanted = new Set(sessionIds);
    const started = claude.map((p) => registry.get(p.pid)?.startedAt).filter((t): t is number => !!t);
    const { usage } = scanTranscripts({ paths: resolvePaths(options.paths), sinceMs: Math.min(since, ...started) });
    for (const r of usage) {
      if (!wanted.has(r.sessionId) || r.isSidechain) continue;
      latest.set(r.sessionId, { ctx: contextSize(r), ts: r.ts });
      if (r.ts >= since) recent.set(r.sessionId, (recent.get(r.sessionId) ?? 0) + weightedTokens(r));
    }
  }

  return claude.map((p) => {
    const reg = registry.get(p.pid);
    const last = reg ? latest.get(reg.sessionId) : undefined;
    return {
      pid: p.pid,
      sessionId: reg?.sessionId,
      cwd: reg?.cwd,
      entrypoint: reg?.entrypoint,
      status: reg?.status,
      tty: p.tty,
      elapsedSeconds: p.elapsedSeconds,
      cpu: p.cpu,
      currentContext: last?.ctx ?? 0,
      recentWeighted: reg ? recent.get(reg.sessionId) ?? 0 : 0,
      lastActivity: last?.ts ?? (reg?.updatedAt || undefined),
      isSelf: self.has(p.pid),
    };
  });
}

export interface StopResult {
  pid: number;
  action: "stopped" | "would-stop" | "skipped";
  reason?: string;
}

export interface StopOptions {
  pids?: number[];
  /** Stop every idle session with no activity for this many hours */
  idleHours?: number;
  /** Default true: report what would be stopped without sending signals */
  dryRun?: boolean;
  sessions?: SessionInfo[];
  kill?: (pid: number) => void;
  now?: number;
}

/**
 * Sends SIGTERM, which Claude Code handles like /exit: the transcript is kept and `claude --resume`
 * reopens it. Only Claude Code processes are touched, never the session running this server.
 */
export function stopSessions(options: StopOptions): StopResult[] {
  const now = options.now ?? Date.now();
  const dryRun = options.dryRun !== false;
  const sessions = options.sessions ?? listSessions();
  const byPid = new Map(sessions.map((s) => [s.pid, s]));
  const kill = options.kill ?? ((pid: number) => process.kill(pid, "SIGTERM"));

  let targets: number[] = options.pids ?? [];
  if (options.idleHours !== undefined) {
    const cutoff = now - options.idleHours * 3_600_000;
    targets = targets.concat(
      sessions
        .filter((s) => s.status !== "busy" && s.cpu < 5 && (s.lastActivity ?? now - s.elapsedSeconds * 1000) < cutoff)
        .map((s) => s.pid)
    );
  }

  const results: StopResult[] = [];
  for (const pid of [...new Set(targets)]) {
    const s = byPid.get(pid);
    if (!s) results.push({ pid, action: "skipped", reason: "not a running Claude Code process" });
    else if (s.isSelf) results.push({ pid, action: "skipped", reason: "this is the session running the optimizer" });
    else if (dryRun) results.push({ pid, action: "would-stop" });
    else {
      try {
        kill(pid);
        results.push({ pid, action: "stopped" });
      } catch (error) {
        results.push({ pid, action: "skipped", reason: (error as Error).message });
      }
    }
  }
  return results;
}
