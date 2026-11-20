# @guardbee/mcp-token-optimizer

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-token-optimizer.svg)](https://www.npmjs.com/package/@guardbee/mcp-token-optimizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/token-optimizer/LICENSE)

An MCP server that finds what is burning Claude Code tokens on this machine, and stops it.

The usual culprit is not a chatty prompt but context size: every message re-sends the whole conversation, so a session at 800k tokens costs about thirty times as much per message as one at 25k. Large file reads and verbose MCP tools push contexts there; forgotten sessions and unused MCP servers add the rest.

> Telemetry is **off** by default. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md). The server reads local files and changes only what you tell it to.

## Tools

| Tool | What it does | Changes anything? |
|---|---|---|
| `optimize_report` | Ranked recommendations: oversized live and past contexts, file reads and MCP servers that flood the context, unused MCP servers, idle sessions, subagent and model mix. | No |
| `list_sessions` | Running Claude Code processes: uptime, CPU, busy/idle, current context size, recent spend. | No |
| `stop_sessions` | Stop sessions by pid or by `idleHours`. | **Dry run by default** |
| `audit_mcp_servers` | Every MCP server Claude Code loads (user, local, `.mcp.json`, plugins, plus claude.ai connectors and built-ins seen in transcripts) with calls and output volume. | No |
| `disable_mcp_servers` | Turn servers off for new sessions without losing their config. | **Dry run by default** |
| `restore_mcp_servers` | Undo `disable_mcp_servers`; with no arguments, lists what is parked. | **Dry run by default** |
| `measure_mcp_definitions` | Start each configured MCP server, list its tools, and measure the tokens their names, descriptions and schemas take. Results feed `optimize_report`. | Runs the servers |
| `install_hooks` / `uninstall_hooks` | Hooks that warn **you** when a session's context passes a threshold, and when one tool result adds a lot of context. | **Dry run by default** |
| `install_statusline` / `uninstall_statusline` | Context size, plan meters, time to reset, per-message plan cost and the foreign-usage alarm in Claude Code's status line. | **Dry run by default** |

### Safety

- **Stopping** sends `SIGTERM` only to Claude Code CLI processes (not the desktop app) and never to the session running the optimizer or its parents. Transcripts are kept; `claude --resume` reopens a stopped session.
- **Disabling** uses Claude Code's own switches where they exist: `disabledMcpjsonServers` for `.mcp.json` servers, `enabledPlugins: false` for plugins. User and local servers have no switch, so their entry is moved to `~/.guardbee/token-optimizer/parked.json` and put back by `restore`. Every write backs up the original file to `~/.guardbee/token-optimizer/backups/` first and is atomic.
- claude.ai connectors and built-in integrations are reported but not touched; they are switched off where they were added.
- Changes apply to sessions started afterwards. A running session may write its own copy of `~/.claude.json` back when it exits, so re-check with `audit_mcp_servers` after closing it.

## Context budget warning

The expensive mistake is a session that keeps growing. The hook checks the session's context before every prompt and, past the threshold (default 200k), shows you a warning; then again at every further 100k, not on every prompt. After `/compact` it re-arms.

```
⚠️ This session's context is 314k tokens (threshold 200k). Every new message re-reads all of it: ~1.8% of the 5-hour limit per message. Run /compact when this task is done, or /clear for a new topic.
```

The plan share appears once [`claude-usage-guard`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/claude-usage-guard) has calibrated. The hook reads only the tail of the transcript (about 0.25 s), prints nothing below the threshold, and never blocks the prompt.

```bash
npx @guardbee/mcp-token-optimizer install-hooks --threshold 150000 --lang tr --apply
```

## Big tool output warning

The same `install-hooks` adds a `PostToolUse` hook for the tools that can return a lot (Read, Bash, Grep, Glob, WebFetch, WebSearch, subagents, MCP tools). When one result adds more than 10k tokens (`--tool-threshold`), you see what it was and how to get it smaller:

```
⚠️ Read (src/generated/schema.ts) added ~38k tokens to the context; every later message in this session re-reads them. Read big files in parts with offset/limit, or Grep for the spot first.
```

Images count about 1,600 tokens each; at most one warning per session every three minutes. The message is for you; nothing is added to the model's context.

## Status line

```
Opus 5.5 · ctx 314k/1M (~3.1%/msg) · 5h 42% ↻2h30m → 100% at 13:55 · 7d 18% · 🚨 foreign usage: detect
```

- **ctx**: the current context and the window size, yellow past the threshold and red at twice it; once calibrated, the share of the 5-hour limit the next message costs.
- **5h / 7d**: the account's plan meters from the latest response (all devices), time to the 5-hour reset, and the time the limit is reached if the current pace gets there first.
- **🚨**: the [claude-usage-guard](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/claude-usage-guard#foreign-usage-alarm) alarm fired in the last 12 hours.

It also stores each fresh meter reading for claude-usage-guard, so detection gets a reading per message instead of per session. It runs in about 0.1 s and costs no tokens. Claude Code has one status line: an existing one is kept unless you pass `--force`.

```bash
npx @guardbee/mcp-token-optimizer install-statusline --lang tr --apply
```

Hooks and the status line start this CLI on every prompt, tool call or message. From a global install (`npm i -g @guardbee/mcp-token-optimizer`) the command is a plain `node` call; from npx it goes through `npx -y` with a pinned version, which is slower.

## Tool-definition cost

`measure_mcp_definitions` starts every enabled server the way Claude Code would (stdio, or HTTP including SSE responses; `${VAR}` and `${VAR:-default}` expanded) and lists its tools:

```
  1k  token-optimizer (user) — 9 tools; largest: disable_mcp_servers ~210, …
✗ remote-x (local, ~/code/app): needs authorization (HTTP 401); sign in from Claude Code's /mcp
```

The figure is the cost when tools are loaded up front. Claude Code defers MCP tools behind tool search when there are many, and then only names cost context until a tool is used.

## Install

```bash
claude mcp add token-optimizer -- npx -y @guardbee/mcp-token-optimizer
```

CLI (changes are dry runs unless `--apply` is given):

```bash
npx @guardbee/mcp-token-optimizer report
npx @guardbee/mcp-token-optimizer sessions
npx @guardbee/mcp-token-optimizer stop --idle-hours 6 --apply
npx @guardbee/mcp-token-optimizer mcp
npx @guardbee/mcp-token-optimizer disable local my-server --project ~/code/app --apply
npx @guardbee/mcp-token-optimizer restore local my-server --project ~/code/app --apply
npx @guardbee/mcp-token-optimizer measure-mcp
npx @guardbee/mcp-token-optimizer install-hooks --apply
npx @guardbee/mcp-token-optimizer install-statusline --apply
```

## Example report

```
🔴 [HIGH] 2 past session(s) ran with contexts up to 871k tokens
   They spent 22.8M weighted tokens, 94% of the window's usage. Past ~150k, most of each message's cost is re-reading old context.
   → Compact long sessions early (/compact), and start a new session (/clear) per task

🟠 [MEDIUM] 1 MCP server(s) unused in the last 7 days
   old-gateway (local, ~/code/legacy-app)
   → disable_mcp_servers (dry run first); restore_mcp_servers brings them back
```

## Limitations

- Tool output is measured in characters (about four per token); images count as ~1,600 tokens each.
- `measure_mcp_definitions` runs the configured server commands; servers that need OAuth are reported, not measured.
- Process listing uses `ps`, so `list_sessions` and `stop_sessions` do nothing on Windows.

## Related

[`@guardbee/mcp-claude-usage-guard`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/claude-usage-guard) checks whether plan usage is coming from somewhere other than this machine. This package uses its transcript reader.
