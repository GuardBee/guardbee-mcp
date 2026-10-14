---
"@guardbee/mcp-config-auditor": minor
---

Shadow MCP discovery: also reads Gemini CLI, Cline and Zed configs (JSON with comments, `context_servers`) and Claude Code's per-project servers; `discover --format=json` adds a secret-free inventory (env and header names only, redacted arguments and URLs, package version and pinning, findings per server); `--upload` sends it to the GuardBee dashboard with a workspace API key.
