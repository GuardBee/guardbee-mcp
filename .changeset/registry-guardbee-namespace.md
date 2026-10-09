---
"@guardbee/mcp-audit-gap-auditor": patch
"@guardbee/mcp-context-oversharing-auditor": patch
"@guardbee/mcp-server-auditor": patch
"@guardbee/mcp-oauth-auditor": patch
"@guardbee/mcp-owasp-scan": patch
"@guardbee/mcp-prompt-injection-scanner": patch
"@guardbee/mcp-prompt-leak-scanner": patch
"@guardbee/mcp-secret-scanner": patch
"@guardbee/mcp-security-proxy": patch
"@guardbee/mcp-toxic-flow-auditor": patch
---

MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.
