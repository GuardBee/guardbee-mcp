import { homedir } from "os";
import { join } from "path";

/** Where Claude Code keeps its state. Every reader takes these so tests can point at a fixture tree. */
export interface ClaudePaths {
  /** ~/.claude (or $CLAUDE_CONFIG_DIR): projects/, sessions/, settings.json */
  claudeDir: string;
  /** ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json): account, MCP servers, cached plan utilization */
  claudeJson: string;
  /** This package's own state (usage snapshots); never inside Claude Code's directory */
  stateDir: string;
}

export function defaultClaudePaths(env: NodeJS.ProcessEnv = process.env): ClaudePaths {
  const configDir = env.CLAUDE_CONFIG_DIR;
  return {
    claudeDir: configDir ?? join(homedir(), ".claude"),
    claudeJson: configDir ? join(configDir, ".claude.json") : join(homedir(), ".claude.json"),
    stateDir: env.GUARDBEE_USAGE_GUARD_DIR ?? join(homedir(), ".guardbee", "claude-usage-guard"),
  };
}

export function resolvePaths(partial: Partial<ClaudePaths> = {}): ClaudePaths {
  return { ...defaultClaudePaths(), ...partial };
}
