# @guardbee/mcp-claude-usage-guard

## 0.2.0

### Minor Changes

- [#324](https://github.com/GuardBee/guardbee-mcp/pull/324) [`d8759d1`](https://github.com/GuardBee/guardbee-mcp/commit/d8759d13bd109d0e18e0db8b6f5206e314471065) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - claude-usage-guard: the hooks now raise a foreign-usage alarm the first time a new plan reading shows usage this machine does not explain, or a login switch (`--lang tr`, `--notify` for a desktop notification). Live meter readings from the status line are stored too, and reset times from the two sources are matched.
  
  token-optimizer: a status line (`install-statusline`) with context size, plan meters, time to reset, per-message plan cost, a limit-before-reset warning and the alarm marker; and a PostToolUse hook that warns when one tool result adds more than 10k tokens (`--tool-threshold`).

- [#324](https://github.com/GuardBee/guardbee-mcp/pull/324) [`7a3455d`](https://github.com/GuardBee/guardbee-mcp/commit/7a3455d480af0d7850faf3a5b70cb52d53612bd2) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - claude-usage-guard: `install_hooks` records plan readings automatically from Claude Code's SessionStart and Stop hooks; `plan_forecast` projects the 5-hour and 7-day meters and flags a limit hit before reset; `usage_report` shows each group's share of a 5-hour limit once calibrated.
  
  token-optimizer: a context-budget hook warns you when a session's context passes a threshold (then every further 100k, with the per-message plan cost when calibrated); `measure_mcp_definitions` measures the tokens each MCP server's tool definitions take, over stdio or HTTP, and feeds `optimize_report`.

## 0.1.1

### Patch Changes

- [#318](https://github.com/GuardBee/guardbee-mcp/pull/318) [`be30095`](https://github.com/GuardBee/guardbee-mcp/commit/be3009545101a52b0530cab35700f324a31d9675) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - No code changes: first release through the npm trusted publisher (0.1.0 was published by hand).
