---
"@guardbee/mcp-dependency-auditor": patch
"@guardbee/mcp-rug-pull-detector": patch
"@guardbee/mcp-security-proxy": patch
"@guardbee/mcp-vulnerability-scanner": patch
"@guardbee/mcp-compliance-checker": patch
"@guardbee/mcp-db-gateway": patch
"@guardbee/mcp-secret-scanner": patch
"@guardbee/mcp-ai-code-scanner": patch
"@guardbee/mcp-prompt-injection-scanner": patch
"@guardbee/mcp-server-auditor": patch
"@guardbee/mcp-tool-poisoning-scanner": patch
"@guardbee/mcp-memory-poisoning-scanner": patch
"@guardbee/mcp-oauth-auditor": patch
"@guardbee/mcp-model-scanner": patch
"@guardbee/mcp-prompt-leak-scanner": patch
"@guardbee/mcp-agent-graph-auditor": patch
---

Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings.
