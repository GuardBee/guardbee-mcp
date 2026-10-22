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
"@guardbee/mcp-rug-pull-detector": patch
"@guardbee/mcp-secret-scanner": patch
"@guardbee/mcp-security-proxy": patch
"@guardbee/security-suite": patch
"@guardbee/mcp-slopsquat-scanner": patch
"@guardbee/mcp-ssl-inspector": patch
"@guardbee/mcp-telemetry": minor
"@guardbee/mcp-threat-rules": patch
"@guardbee/mcp-tool-poisoning-scanner": patch
"@guardbee/mcp-toxic-flow-auditor": patch
"@guardbee/mcp-unbounded-consumption-auditor": patch
"@guardbee/mcp-vector-store-scanner": patch
"@guardbee/mcp-vulnerability-scanner": patch
---

MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.
