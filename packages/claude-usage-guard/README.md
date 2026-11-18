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

## How detection works

1. **Plan readings.** Claude Code caches the meters it shows in `/usage` in `~/.claude.json`. Each call stores that reading in `~/.guardbee/claude-usage-guard/snapshots.jsonl`.
2. **Local spend.** Transcripts under `~/.claude/projects` give every model call this machine made. Claude Code writes one line per content block and repeats the response's usage on each, so calls are counted once per message id (summing every line overstates usage 2-3x).
3. **Weighting.** Limits follow cost, not raw tokens: `input + 1.25×cache write + 0.1×cache read + 5×output`, scaled down for Sonnet and Haiku.
4. **Comparison.** For each pair of readings inside the same limit window:
   - meter rose **3+ points while this machine was idle** → flagged without any calibration;
   - otherwise, once three busy intervals have taught it how many weighted tokens one point costs, an interval where this machine explains less than half of the rise is flagged.
5. **Local signals.** A plan reading fetched for another account than the signed-in one, SDK or script entrypoints (`sdk-ts`, `sdk-py`, …) spending your login, `who` showing remote logins, non-interactive Claude Code processes.

"Usage from somewhere else" is not necessarily another person: your own claude.ai, desktop or mobile chats share the same limits. The report says so.

### Getting enough readings

Claude Code refreshes the cached meters when it fetches `/usage`. One reading is not enough; run `detect` a few times over a working day, or schedule the snapshot command:

```bash
# every 30 minutes
*/30 * * * * npx -y @guardbee/mcp-claude-usage-guard snapshot
```

## Install

```bash
claude mcp add claude-usage-guard -- npx -y @guardbee/mcp-claude-usage-guard
```

CLI:

```bash
npx @guardbee/mcp-claude-usage-guard detect            # verdict + signals (exit 2 on likely-other-usage)
npx @guardbee/mcp-claude-usage-guard report --hours 168 --by entrypoint
npx @guardbee/mcp-claude-usage-guard snapshot
```

`CLAUDE_CONFIG_DIR` is honoured. `GUARDBEE_USAGE_GUARD_DIR` moves the snapshot store.

## Limitations

- Only this machine's Claude Code is visible. Another device appears as unexplained plan usage, not by name.
- `cachedUsageUtilization` is an internal Claude Code field. If it disappears or changes shape, the server falls back to local signals only and says so.
- Meters are whole percentages, so one point of movement is treated as rounding.
- Model weights are approximate relative prices.

## Related

[`@guardbee/mcp-token-optimizer`](https://github.com/GuardBee/guardbee-mcp/tree/main/packages/token-optimizer) finds what is burning tokens on this machine and stops it.
