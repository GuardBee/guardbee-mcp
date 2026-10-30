---
"@guardbee/mcp-a2a-auditor": minor
"@guardbee/mcp-agent-graph-auditor": minor
"@guardbee/mcp-ai-code-scanner": minor
"@guardbee/mcp-audit-gap-auditor": minor
"@guardbee/mcp-compliance-checker": minor
"@guardbee/mcp-context-oversharing-auditor": minor
"@guardbee/mcp-db-gateway": minor
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
"@guardbee/mcp-reverse-shield": minor
"@guardbee/mcp-rug-pull-detector": minor
"@guardbee/mcp-secret-scanner": minor
"@guardbee/security-suite": minor
"@guardbee/mcp-slopsquat-scanner": minor
"@guardbee/mcp-ssl-inspector": minor
"@guardbee/mcp-telemetry": patch
"@guardbee/mcp-threat-rules": minor
"@guardbee/mcp-tool-poisoning-scanner": minor
"@guardbee/mcp-toxic-flow-auditor": minor
"@guardbee/mcp-unbounded-consumption-auditor": minor
"@guardbee/mcp-vector-store-scanner": minor
"@guardbee/mcp-vulnerability-scanner": minor
---

Move to the MCP TypeScript SDK v2: every server now speaks MCP 2026-07-28 as well as 2025-11-25, choosing per connection (`serveStdio`). Tools without arguments no longer declare an empty input schema. The rug-pull detector and owasp-scan connect to target servers with version negotiation, so they read servers on either revision. `instrumentServer` from `@guardbee/mcp-telemetry` accepts an SDK v1 or v2 server.
