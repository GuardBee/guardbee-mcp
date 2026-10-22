---
"@guardbee/mcp-a2a-auditor": patch
"@guardbee/mcp-agent-graph-auditor": patch
"@guardbee/mcp-ai-code-scanner": patch
"@guardbee/mcp-audit-gap-auditor": patch
"@guardbee/mcp-compliance-checker": patch
"@guardbee/mcp-context-oversharing-auditor": patch
"@guardbee/mcp-db-gateway": patch
"@guardbee/mcp-dependency-auditor": patch
"@guardbee/mcp-dns-intelligence": patch
"@guardbee/mcp-document-scanner": patch
"@guardbee/mcp-elicitation-auditor": patch
"@guardbee/guard-core": patch
"@guardbee/mcp-llm-redteam": patch
"@guardbee/mcp-config-auditor": patch
"@guardbee/mcp-server-auditor": patch
"@guardbee/mcp-memory-poisoning-scanner": patch
"@guardbee/mcp-model-scanner": patch
"@guardbee/ner": patch
"@guardbee/mcp-oauth-auditor": patch
"@guardbee/mcp-owasp-scan": patch
"@guardbee/mcp-prompt-injection-scanner": patch
"@guardbee/mcp-prompt-leak-scanner": patch
"@guardbee/mcp-rug-pull-detector": patch
"@guardbee/mcp-secret-scanner": patch
"@guardbee/mcp-security-proxy": patch
"@guardbee/security-suite": patch
"@guardbee/mcp-slopsquat-scanner": patch
"@guardbee/mcp-ssl-inspector": patch
"@guardbee/mcp-threat-rules": patch
"@guardbee/mcp-tool-poisoning-scanner": patch
"@guardbee/mcp-toxic-flow-auditor": patch
"@guardbee/mcp-unbounded-consumption-auditor": patch
"@guardbee/mcp-vector-store-scanner": patch
"@guardbee/mcp-vulnerability-scanner": patch
"@guardbee/mcp-telemetry": minor
---

Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.

**Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
