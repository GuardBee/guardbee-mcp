---
"@guardbee/mcp-security-proxy": patch
---

The in-session tool pin now hashes tool definitions with guard-core's `hashToolDefinition`, the same hash the persistent pin store and rug-pull-detector baselines use. A server that changes only a tool's `outputSchema` during a session is now reported (and blocked in `block` mode) like any other definition change.
