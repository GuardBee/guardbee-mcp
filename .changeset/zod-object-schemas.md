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
"@guardbee/mcp-llm-redteam": patch
"@guardbee/mcp-config-auditor": patch
"@guardbee/mcp-server-auditor": patch
"@guardbee/mcp-memory-poisoning-scanner": patch
"@guardbee/mcp-model-scanner": patch
"@guardbee/mcp-oauth-auditor": patch
"@guardbee/mcp-owasp-scan": patch
"@guardbee/mcp-prompt-injection-scanner": patch
"@guardbee/mcp-prompt-leak-scanner": patch
"@guardbee/mcp-reverse-shield": patch
"@guardbee/mcp-rug-pull-detector": patch
"@guardbee/mcp-secret-scanner": patch
"@guardbee/mcp-slopsquat-scanner": patch
"@guardbee/mcp-ssl-inspector": patch
"@guardbee/mcp-threat-rules": patch
"@guardbee/mcp-tool-poisoning-scanner": patch
"@guardbee/mcp-toxic-flow-auditor": patch
"@guardbee/mcp-unbounded-consumption-auditor": patch
"@guardbee/mcp-vector-store-scanner": patch
"@guardbee/mcp-vulnerability-scanner": patch
---

Tool schemas are now declared with `z.object(...)` instead of raw Zod shapes, which MCP SDK v2 deprecates. The JSON Schema sent to clients is unchanged.
