---
"@guardbee/mcp-claude-usage-guard": minor
"@guardbee/mcp-token-optimizer": minor
---

claude-usage-guard: `install_hooks` records plan readings automatically from Claude Code's SessionStart and Stop hooks; `plan_forecast` projects the 5-hour and 7-day meters and flags a limit hit before reset; `usage_report` shows each group's share of a 5-hour limit once calibrated.

token-optimizer: a context-budget hook warns you when a session's context passes a threshold (then every further 100k, with the per-message plan cost when calibrated); `measure_mcp_definitions` measures the tokens each MCP server's tool definitions take, over stdio or HTTP, and feeds `optimize_report`.
