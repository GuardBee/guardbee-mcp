import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ClaudePaths } from "../paths.js";

export function tempClaude(): ClaudePaths {
  const root = mkdtempSync(join(tmpdir(), "guardbee-usage-"));
  const paths = { claudeDir: join(root, ".claude"), claudeJson: join(root, ".claude.json"), stateDir: join(root, ".guardbee", "claude-usage-guard") };
  mkdirSync(join(paths.claudeDir, "projects"), { recursive: true });
  return paths;
}

export interface CallSpec {
  ts: number;
  sessionId?: string;
  id?: string;
  model?: string;
  entrypoint?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  isSidechain?: boolean;
  /** How many content-block lines repeat this response's usage, as Claude Code writes them */
  blocks?: number;
}

let counter = 0;

export function assistantLines(spec: CallSpec): string[] {
  const id = spec.id ?? `msg_${++counter}`;
  const lines: string[] = [];
  for (let i = 0; i < (spec.blocks ?? 1); i++) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(spec.ts).toISOString(),
        sessionId: spec.sessionId ?? "s1",
        cwd: "/work/app",
        entrypoint: spec.entrypoint ?? "cli",
        isSidechain: spec.isSidechain ?? false,
        requestId: `req_${id}`,
        message: {
          id,
          model: spec.model ?? "claude-opus-5-5",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: spec.input ?? 0,
            output_tokens: spec.output ?? 0,
            cache_read_input_tokens: spec.cacheRead ?? 0,
            cache_creation_input_tokens: spec.cacheWrite ?? 0,
          },
        },
      })
    );
  }
  return lines;
}

export function writeTranscript(paths: ClaudePaths, project: string, sessionId: string, lines: string[]): string {
  const dir = join(paths.claudeDir, "projects", project);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

export function writeClaudeJson(paths: ClaudePaths, value: unknown): void {
  writeFileSync(paths.claudeJson, JSON.stringify(value));
}

export function planCache(fetchedAtMs: number, fiveHour: number, sevenDay: number, accountUuid = "acct-1") {
  return {
    fetchedAtMs,
    accountUuid,
    utilization: {
      five_hour: { utilization: fiveHour, resets_at: "2026-11-18T20:00:00Z" },
      seven_day: { utilization: sevenDay, resets_at: "2026-11-22T00:00:00Z" },
    },
  };
}
