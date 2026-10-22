---
"@guardbee/security-suite": minor
"@guardbee/mcp-a2a-auditor": minor
"@guardbee/mcp-agent-graph-auditor": minor
"@guardbee/mcp-ai-code-scanner": minor
"@guardbee/mcp-audit-gap-auditor": minor
"@guardbee/mcp-compliance-checker": minor
"@guardbee/mcp-context-oversharing-auditor": minor
"@guardbee/mcp-dependency-auditor": minor
"@guardbee/mcp-dns-intelligence": minor
"@guardbee/mcp-document-scanner": minor
"@guardbee/mcp-elicitation-auditor": minor
"@guardbee/mcp-llm-redteam": minor
"@guardbee/mcp-config-auditor": minor
"@guardbee/mcp-server-auditor": minor
"@guardbee/mcp-memory-poisoning-scanner": minor
"@guardbee/mcp-model-scanner": minor
"@guardbee/mcp-oauth-auditor": minor
"@guardbee/mcp-owasp-scan": minor
"@guardbee/mcp-prompt-injection-scanner": minor
"@guardbee/mcp-prompt-leak-scanner": minor
"@guardbee/mcp-rug-pull-detector": minor
"@guardbee/mcp-secret-scanner": minor
"@guardbee/mcp-slopsquat-scanner": minor
"@guardbee/mcp-ssl-inspector": minor
"@guardbee/mcp-threat-rules": minor
"@guardbee/mcp-tool-poisoning-scanner": minor
"@guardbee/mcp-toxic-flow-auditor": minor
"@guardbee/mcp-unbounded-consumption-auditor": minor
"@guardbee/mcp-vector-store-scanner": minor
"@guardbee/mcp-vulnerability-scanner": minor
---

`security-suite` now covers every GuardBee scanner and auditor (29 packages, 124 MCP tools). `guardbee serve` serves the recommended group by default (owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor: 31 tools); `--tools=` (or `GUARDBEE_SUITE_TOOLS`) takes groups (`code`, `supply-chain`, `network`, `platform`, `all`) and package ids. Tool names carry their package's prefix (`secrets_scan_text`, `injection_scan_text`) so packages do not collide. `guardbee <package-id> <args>` runs any package's CLI and `guardbee list` lists them; the old `secret-scan`, `dep-audit`, `ssl-inspect` and `dns-check` shortcuts still work. With no arguments and no terminal on stdin (an MCP client starting it), the suite now serves instead of printing help, and its MCP Registry entry passes `serve`.

**Breaking for `guardbee serve` users:** the five plain tool names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`) are now prefixed package tools; see "Upgrading from 0.2" in the README.

Every scanner and auditor package exports `registerTools(server)`, which registers its MCP tools on a given `McpServer`; `startServer()` uses it.
