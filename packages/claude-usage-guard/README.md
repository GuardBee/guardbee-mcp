# @guardbee/mcp-claude-usage-guard

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-claude-usage-guard.svg)](https://www.npmjs.com/package/@guardbee/mcp-claude-usage-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/claude-usage-guard/LICENSE)

An MCP server that answers one question: **is all of my Claude plan usage coming from me?**

Your plan's 5-hour and 7-day limits are shared by everything signed in to the account: Claude Code on every machine, claude.ai, the desktop and mobile apps, and any script that borrowed your login. When the limits run out faster than expected, this server compares the account-wide plan meter with what Claude Code on this machine actually spent, and points at the gap.

> Telemetry is **off** by default. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md). Nothing else leaves the machine: the server only reads local files.

```
plan meter (whole account, from Claude Code's /usage cache)
        │          ┌──────────────────────────────────────────┐
        ├─ rose ──►│ explained by this machine's transcripts? │── yes ─► ✅ no evidence
        │          └──────────────────────────────────────────┘
        │                              │ no
        │                              ▼
        │                 🚨 usage from somewhere else
        │
        └─ plus local signals: account switch · SDK/script use of your login · remote logins · background sessions
```

## Tools

| Tool | What it does |
|---|---|
| `detect_foreign_usage` | Records a plan reading, compares the meter's movement between readings with this machine's usage, and reports a verdict: `insufficient-data`, `no-evidence`, `suspicious` or `likely-other-usage`. |
| `usage_report` | This machine's Claude Code usage from local transcripts, by session, day, project, entrypoint or model, with each session's peak context size. |
| `account_status` | Which account Claude Code is signed in to, and the 5-hour / 7-day meters it last fetched. |
| `plan_forecast` | Current 5-hour / 7-day meters, the pace (from the plan meter across all devices, or this machine's usage once calibrated), and whether the limit is hit before it resets. |
| `install_hooks` / `uninstall_hooks` | Add or remove the Claude Code hooks that record plan readings automatically and raise the foreign-usage alarm (optionally as a desktop notification). Dry run by default. |

## How detection works

1. **Plan readings.** Claude Code caches the meters it shows in `/usage` in `~/.claude.json`. Each call stores that reading in `~/.guardbee/claude-usage-guard/snapshots.jsonl`.
2. **Local spend.** Transcripts under `~/.claude/projects` give every model call this machine made. Claude Code writes one line per content block and repeats the response's usage on each, so calls are counted once per message id (summing every line overstates usage 2-3x).
3. **Weighting.** Limits follow cost, not raw tokens: `input + 1.25×cache write + 0.1×cache read + 5×output`, scaled down for Sonnet and Haiku.
4. **Comparison.** For each pair of readings inside the same limit window:
   - meter rose **3+ points while this machine was idle** → flagged without any calibration;
   - otherwise, once three busy intervals have taught it how many weighted tokens one point costs, an interval where this machine explains less than half of the rise is flagged.
5. **Local signals.** A plan reading fetched for another account than the signed-in one, SDK or script entrypoints (`sdk-ts`, `sdk-py`, …) spending your login, `who` showing remote logins, non-interactive Claude Code processes.

"Usage from somewhere else" is not necessarily another person: your own claude.ai, desktop or mobile chats share the same limits. The report says so.

### Getting enough readings: hooks

One reading is not enough. Install the hooks once and every Claude Code session start and turn end records the current reading (deduplicated by fetch time, silent, never blocks the session):

```bash
npx @guardbee/mcp-claude-usage-guard install-hooks          # shows the change
npx @guardbee/mcp-claude-usage-guard install-hooks --apply  # writes ~/.claude/settings.json (backed up first)
npx @guardbee/mcp-claude-usage-guard uninstall-hooks --apply
```

Your other hooks are left alone: ours are found by a `# guardbee:claude-usage-guard` tag on the command. Claude Code refreshes its cached meters when it starts and when `/usage` is opened, so from the hooks alone readings arrive per session rather than per minute.

**Readings with every message.** Claude Code also passes the live meters of the latest response to its status line. The [`token-optimizer` status line](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/token-optimizer#status-line) stores them here (only after a fresh response, and only when the meter moved or ten minutes passed), which turns per-session readings into per-message ones.

### Foreign-usage alarm

With the hooks installed, every new reading is checked right away. The first time a stretch of usage this machine does not explain shows up, the session gets a message (and, with `--notify`, a macOS or Linux desktop notification):

```
🚨 GuardBee: the plan meter rose 8.0 pt between 20 Nov, 09:10 and 20 Nov, 11:00; Claude Code on this machine was idle then. That usage came from elsewhere: another device or person, or your own claude.ai web/desktop/mobile chats (they share the limit). …
```

Each stretch alarms once; a check without new readings costs nothing, one with new readings about 0.2 s. A login switch on this machine alarms too.

```bash
npx @guardbee/mcp-claude-usage-guard install-hooks --lang tr --notify --apply
```

## Plan forecast and plan share

`plan_forecast` projects each window: `5-hour: 62%, 18.0 pt/hour (from the plan meter, all devices) ⚠️ at this pace the limit is reached 14:20 UTC, before the reset`. A reading from before the window's last reset is reported as stale instead of projected.

Once calibrated, `usage_report` adds a **5h plan** column: what share of a full 5-hour limit each session (or day, project, model) cost.

## Install

```bash
claude mcp add claude-usage-guard -- npx -y @guardbee/mcp-claude-usage-guard
```

CLI:

```bash
npx @guardbee/mcp-claude-usage-guard detect            # verdict + signals (exit 2 on likely-other-usage)
npx @guardbee/mcp-claude-usage-guard report --hours 168 --by entrypoint
npx @guardbee/mcp-claude-usage-guard forecast
npx @guardbee/mcp-claude-usage-guard install-hooks --notify --apply
```

`CLAUDE_CONFIG_DIR` is honoured. `GUARDBEE_USAGE_GUARD_DIR` moves the snapshot store.

## Limitations

- Only this machine's Claude Code is visible. Another device appears as unexplained plan usage, not by name.
- `cachedUsageUtilization` is an internal Claude Code field. If it disappears or changes shape, the server falls back to local signals only and says so.
- Meters are whole percentages, so one point of movement is treated as rounding.
- Model weights are approximate relative prices.

## Related

[`@guardbee/mcp-token-optimizer`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/token-optimizer) finds what is burning tokens on this machine and stops it.
