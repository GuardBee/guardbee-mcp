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
"@guardbee/mcp-document-scanner": minor
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
"@guardbee/mcp-security-proxy": minor
"@guardbee/security-suite": minor
"@guardbee/mcp-slopsquat-scanner": patch
"@guardbee/mcp-ssl-inspector": patch
"@guardbee/mcp-threat-rules": patch
"@guardbee/mcp-tool-poisoning-scanner": patch
"@guardbee/mcp-toxic-flow-auditor": patch
"@guardbee/mcp-unbounded-consumption-auditor": patch
"@guardbee/mcp-vector-store-scanner": patch
"@guardbee/mcp-vulnerability-scanner": patch
---

- **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
- **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
- **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
- The proxy's npm description starts with "MCP security gateway" again.
