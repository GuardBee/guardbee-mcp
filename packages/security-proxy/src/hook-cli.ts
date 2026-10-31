#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { AuditLogger } from "./audit/logger.js";
import { loadGatewayConfig, parseGatewayYaml, type GatewayConfig } from "./gateway/config.js";
import { AGENTS, handleEvent, isExitAnswer, type AgentName } from "./hooks/agents.js";
import { HookEngine } from "./hooks/engine.js";
import { install, planInstall, uninstall } from "./hooks/install.js";
import { stateDir } from "./hooks/state.js";

const USAGE = `guardbee-hook — GuardBee policy for coding agents' own tools (shell, file reads, web fetch)

  guardbee-hook install   --claude-code|--cursor|--codex|--gemini-cli|--windsurf [--project] [--config <guardbee-proxy.yaml>] [--fail-closed] [--dry-run]
  guardbee-hook uninstall --claude-code|--cursor|--codex|--gemini-cli|--windsurf [--project]
  guardbee-hook <claude-code|cursor|codex|gemini-cli|windsurf> [--config <file>] [--fail-closed]   (run by the agent; reads the event on stdin)`;

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

/** --config, GUARDBEE_PROXY_CONFIG, ~/.guardbee/guardbee-proxy.yaml, or the built-in defaults. */
function loadConfig(args: string[]): GatewayConfig {
  const explicit = flag(args, "--config") ?? process.env["GUARDBEE_PROXY_CONFIG"];
  const fallback = path.join(os.homedir(), ".guardbee", "guardbee-proxy.yaml");
  if (explicit) return loadGatewayConfig(["--config", explicit]);
  if (fs.existsSync(fallback)) return loadGatewayConfig(["--config", fallback]);
  return parseGatewayYaml("version: 1\nhooks: {}\n", "built-in defaults");
}

/** Hooks write their audit trail to a file: an agent shows a hook's stderr to the user. */
function auditFor(config: GatewayConfig): AuditLogger {
  if (config.audit.sink === "file") return new AuditLogger(config.audit);
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  return new AuditLogger({ ...config.audit, sink: "file", filePath: path.join(stateDir(), "audit.jsonl") });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function run(agent: AgentName, args: string[]): Promise<void> {
  const failClosed = args.includes("--fail-closed");
  let event: Record<string, unknown> = {};
  try {
    event = JSON.parse(await readStdin()) as Record<string, unknown>;
    const config = loadConfig(args);
    const audit = auditFor(config);
    const out = await handleEvent(agent, new HookEngine(config, audit), event);
    await audit.close();
    if (isExitAnswer(out)) {
      process.stderr.write(out.stderr + "\n");
      process.exitCode = out.exitCode;
    } else if (out) process.stdout.write(JSON.stringify(out));
  } catch (err) {
    const message = `GuardBee hook error: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(message + "\n");
    if (!failClosed) return;
    if (agent === "cursor") process.stdout.write(JSON.stringify({ permission: "deny", user_message: message }));
    else if (agent === "gemini-cli") process.stdout.write(JSON.stringify({ decision: "deny", reason: message }));
    // Claude Code, Codex and Windsurf block on exit code 2 (stderr is the reason)
    else process.exitCode = 2;
  }
}

function agentFlag(args: string[]): AgentName {
  const named = AGENTS.find((agent) => args.includes(`--${agent}`));
  if (!named) throw new Error(`Name the agent: ${AGENTS.map((a) => `--${a}`).join(", ")}\n\n${USAGE}`);
  return named;
}

const RESTART: Record<AgentName, string> = {
  "claude-code": "Takes effect in new Claude Code sessions.",
  cursor: "Restart Cursor to load the hooks.",
  codex: "Codex asks you to review new hooks before they run: open /hooks in Codex and trust them.",
  "gemini-cli": "Takes effect in new Gemini CLI sessions (tools.enableHooks and hooks.enabled are on).",
  windsurf: "Restart Windsurf to load the hooks.",
};

function main(): Promise<void> | void {
  const [command, ...args] = process.argv.slice(2);
  if (command && (AGENTS as string[]).includes(command)) return run(command as AgentName, args);
  const script = fs.realpathSync(__filename);
  if (command === "install") {
    const options = {
      agent: agentFlag(args),
      project: args.includes("--project"),
      ...(flag(args, "--config") ? { config: flag(args, "--config")! } : {}),
      failClosed: args.includes("--fail-closed"),
    };
    if (args.includes("--dry-run")) {
      const plan = planInstall(options, script);
      process.stdout.write(`${plan.file}\n${JSON.stringify(plan.settings, null, 2)}\n`);
      return;
    }
    const result = install(options, script);
    process.stdout.write(`Installed GuardBee hooks in ${result.file}${result.backup ? ` (backup: ${result.backup})` : ""}\n  ${result.command}\n`);
    if (/[\\/]_npx[\\/]/.test(script)) {
      process.stdout.write("Note: this runs from the npx cache, which can be cleared. For a stable path: npm i -g @guardbee/mcp-security-proxy && guardbee-hook install …\n");
    }
    process.stdout.write(`${RESTART[options.agent]}\n`);
    return;
  }
  if (command === "uninstall") {
    const result = uninstall({ agent: agentFlag(args), project: args.includes("--project") });
    process.stdout.write(result.removed ? `Removed GuardBee hooks from ${result.file} (backup: ${result.backup})\n` : `No GuardBee hooks in ${result.file}\n`);
    return;
  }
  process.stdout.write(USAGE + "\n");
  if (command && command !== "--help" && command !== "-h") process.exitCode = 2;
}

Promise.resolve()
  .then(main)
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  });
