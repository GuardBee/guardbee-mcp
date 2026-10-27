import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { TaintTracker } from "../gateway/taint.js";

/**
 * Each hook call is its own process, so a session's taint lives in a small
 * file: which tool first brought untrusted content and which first brought
 * sensitive data. Files are per agent session and removed after a day.
 */

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function stateDir(): string {
  return path.join(process.env["XDG_STATE_HOME"] || path.join(os.homedir(), ".local", "state"), "guardbee", "hooks");
}

function fileFor(dir: string, agent: string, session: string): string {
  // The session id comes from the agent: hash it rather than trust it as a file name
  const id = createHash("sha256").update(`${agent}\0${session}`).digest("hex").slice(0, 32);
  return path.join(dir, `${id}.json`);
}

export function loadTaint(agent: string, session: string, dir = stateDir()): TaintTracker {
  try {
    return TaintTracker.restore(JSON.parse(fs.readFileSync(fileFor(dir, agent, session), "utf8")));
  } catch {
    return new TaintTracker();
  }
}

export function saveTaint(agent: string, session: string, taint: TaintTracker, dir = stateDir()): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = fileFor(dir, agent, session);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(taint), { mode: 0o600 });
  fs.renameSync(tmp, file);
  prune(dir);
}

function prune(dir: string): void {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (now - fs.statSync(full).mtimeMs > MAX_AGE_MS) fs.rmSync(full, { force: true });
    }
  } catch {
    // Housekeeping only
  }
}
