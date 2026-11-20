---
"@guardbee/mcp-claude-usage-guard": minor
"@guardbee/mcp-token-optimizer": minor
---

claude-usage-guard: the hooks now raise a foreign-usage alarm the first time a new plan reading shows usage this machine does not explain, or a login switch (`--lang tr`, `--notify` for a desktop notification). Live meter readings from the status line are stored too, and reset times from the two sources are matched.

token-optimizer: a status line (`install-statusline`) with context size, plan meters, time to reset, per-message plan cost, a limit-before-reset warning and the alarm marker; and a PostToolUse hook that warns when one tool result adds more than 10k tokens (`--tool-threshold`).
