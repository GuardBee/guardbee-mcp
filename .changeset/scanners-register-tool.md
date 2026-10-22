---
"@guardbee/mcp-toxic-flow-auditor": patch
"@guardbee/mcp-tool-poisoning-scanner": patch
"@guardbee/mcp-server-auditor": patch
"@guardbee/mcp-audit-gap-auditor": patch
"@guardbee/mcp-unbounded-consumption-auditor": patch
"@guardbee/mcp-ai-code-scanner": patch
---

Source scans now see tools registered with `server.registerTool("name", { description, inputSchema }, handler)`, the MCP TypeScript SDK's current form, not only the deprecated `server.tool(...)`. Before, a server written with `registerTool` got no findings from these rules: toxic-flow-auditor's lethal-trifecta check, tool-poisoning-scanner's description and parameter checks (the description is read from the config object), mcp-server-auditor's shell-tool-name and `z.any()` rules, audit-gap-auditor's "tools without an audit trail", unbounded-consumption-auditor's missing rate limit, and ai-code-scanner's excessive-agency tool name.
