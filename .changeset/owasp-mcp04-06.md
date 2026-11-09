---
"@guardbee/mcp-owasp-scan": minor
"@guardbee/mcp-dependency-auditor": patch
---

OWASP path scan can now cover MCP04 and MCP06 in one pass: `--with-supply-chain` / `withSupplyChain` runs dependency-auditor (OSV) and slopsquat-scanner; `--with-content` / `withContent` runs prompt-injection-scanner. Categories left off appear in the report's `notRun` field. dependency-auditor exports `auditDirectory` / `vulnsAsFindings` for meta-scanners.
