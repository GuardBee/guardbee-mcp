---
"@guardbee/mcp-compliance-checker": patch
"@guardbee/mcp-dependency-auditor": patch
"@guardbee/mcp-dns-intelligence": patch
"@guardbee/mcp-secret-scanner": patch
"@guardbee/mcp-security-proxy": patch
"@guardbee/security-suite": patch
"@guardbee/mcp-ssl-inspector": patch
"@guardbee/mcp-vulnerability-scanner": patch
---

Add Smithery.ai integration files (`smithery.yaml`, `manifest.json`, `.well-known/mcp/server-card.json`), matching the pattern already used by `@guardbee/mcp-db-gateway`, so these servers are one-click installable from Smithery and discoverable via their MCP server card. No functional/runtime code changes — these files are read from the GitHub repo by Smithery, not from the published npm tarball (`package.json` `files` is unchanged).
