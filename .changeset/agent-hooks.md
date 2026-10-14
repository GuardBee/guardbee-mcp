---
"@guardbee/mcp-security-proxy": minor
---

`guardbee-hook`: the proxy's policy for coding agents' own tools. `guardbee-hook install --claude-code|--cursor` adds PreToolUse/PostToolUse (Claude Code) or shell/MCP/file-read hooks (Cursor). Built-in tools are labelled (secret files and env dumps `sensitive`, curl/git push/publish `egress`, rm -rf/force push `destructive`, web tools `untrusted` + `egress`); credentials on their way out, policy rules (`upstream: claude-code|cursor`) and the lethal-trifecta check run before each call, with the session's taint kept on disk; PII, injected instructions and topic rules are checked on the output. `uninstall` removes only GuardBee's entries.
