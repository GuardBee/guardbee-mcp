import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { scanDirectory, scanFile, type Finding } from "./scanner.js";

/**
 * Where coding agents keep what was said in a session. A key pasted into a
 * chat, or printed by a command the agent ran, stays in these files — and was
 * already sent to the model provider. Paths are relative to the home folder.
 */
export const AGENT_HISTORY_LOCATIONS: { agent: string; path: string }[] = [
  { agent: "claude-code", path: ".claude/projects" },
  { agent: "claude-code", path: ".claude.json" },
  { agent: "codex", path: ".codex/sessions" },
  { agent: "codex", path: ".codex/history.jsonl" },
  { agent: "gemini-cli", path: ".gemini/tmp" },
  { agent: "continue", path: ".continue/sessions" },
];

export interface AgentHistoryFinding extends Finding {
  agent: string;
  /** Times the same secret appears across the agent's files; `file`/`line` is the first. */
  occurrences: number;
}

export interface AgentHistoryResult {
  sources: { agent: string; path: string; files: number }[];
  scannedFiles: number;
  totalFindings: number;
  findings: AgentHistoryFinding[];
  durationMs: number;
}

export function scanAgentHistory(options: { home?: string; entropy?: boolean; maxFiles?: number } = {}): AgentHistoryResult {
  const start = Date.now();
  const home = options.home ?? homedir();
  // Transcripts are full of code the agent read: random-looking values there are mostly not secrets
  const entropy = options.entropy ?? false;
  const sources: AgentHistoryResult["sources"] = [];
  const bySecret = new Map<string, AgentHistoryFinding>();
  let scannedFiles = 0;

  for (const location of AGENT_HISTORY_LOCATIONS) {
    const path = join(home, location.path);
    if (!existsSync(path)) continue;
    let findings: Finding[];
    let files: number;
    if (statSync(path).isDirectory()) {
      const result = scanDirectory(path, { maxFiles: options.maxFiles ?? 20_000, entropy });
      findings = result.findings;
      files = result.scannedFiles;
    } else {
      const result = scanFile(path, path, { entropy });
      findings = result.findings;
      files = result.skipped ? 0 : 1;
    }
    scannedFiles += files;
    sources.push({ agent: location.agent, path, files });
    for (const finding of findings) {
      // The same key pasted into ten sessions is one secret to rotate
      const key = `${location.agent}\0${finding.valueHash}`;
      const seen = bySecret.get(key);
      if (seen) seen.occurrences++;
      else bySecret.set(key, { ...finding, agent: location.agent, occurrences: 1 });
    }
  }

  const findings = [...bySecret.values()];
  return { sources, scannedFiles, totalFindings: findings.length, findings, durationMs: Date.now() - start };
}
