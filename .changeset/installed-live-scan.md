---
"@guardbee/mcp-owasp-scan": minor
"@guardbee/mcp-config-auditor": minor
---

`guardbee-owasp-scan installed`: find every MCP server configured on the machine, connect to each and audit its tools in one command. Reports tool poisoning and toxic flows per server, lethal trifectas and tool shadowing that only exist across servers, tool definitions that changed since the last run (pins in `~/.guardbee/tool-pins`) and Shadow MCP against an allowlist. Remote servers use the headers from their config and fall back to legacy SSE; local servers start only with `--run-stdio`. `live --url` also falls back to SSE.

Discovery now reads Codex (`~/.codex/config.toml`), Kiro, Copilot CLI, Amazon Q, LM Studio, Roo Code and opencode configs.
