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

### Safety

- **Stopping** sends `SIGTERM` only to Claude Code CLI processes (not the desktop app) and never to the session running the optimizer or its parents. Transcripts are kept; `claude --resume` reopens a stopped session.
- **Disabling** uses Claude Code's own switches where they exist: `disabledMcpjsonServers` for `.mcp.json` servers, `enabledPlugins: false` for plugins. User and local servers have no switch, so their entry is moved to `~/.guardbee/token-optimizer/parked.json` and put back by `restore`. Every write backs up the original file to `~/.guardbee/token-optimizer/backups/` first and is atomic.
- claude.ai connectors and built-in integrations are reported but not touched; they are switched off where they were added.
- Changes apply to sessions started afterwards. A running session may write its own copy of `~/.claude.json` back when it exits, so re-check with `audit_mcp_servers` after closing it.

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
- The cost of an MCP server's tool definitions is not measured; Claude Code loads many of them on demand.
- Process listing uses `ps`, so `list_sessions` and `stop_sessions` do nothing on Windows.

## Related

[`@guardbee/mcp-claude-usage-guard`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/claude-usage-guard) checks whether plan usage is coming from somewhere other than this machine. This package uses its transcript reader.
