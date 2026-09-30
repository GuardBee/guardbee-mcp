---
"@guardbee/mcp-security-proxy": major
"@guardbee/mcp-toxic-flow-auditor": patch
---

security-proxy 1.0: gateway mode.

- `guardbee-proxy.yaml` puts several MCP servers behind one proxy. Tools and prompts are exposed as `<upstream>__<tool>`; one failing server no longer hides the others' tools.
- Policy rules (`allow` / `deny` / `mask` / `warn`) match on tool glob, upstream, label and session taint; the first match wins.
- Toxic-flow (lethal trifecta) tracking across servers: once a session has read untrusted content and sensitive data, an egress call is blocked (`taint.mode: strict`, the YAML default) or logged (`warn`).
- `resources/read` is now scanned for injection, PII-masked, and counted as untrusted content.
- The audit log is hash-chained (`guardbee-proxy verify-audit <file>`). With the YAML config it stores a SHA-256 of the arguments instead of the arguments, and no results, unless `audit.includePayloads: true`.
- New `guardbee-proxy validate` command.

The single-server `guardbee-proxy -- <command>` form and `guardbee-proxy.json` keep their 0.x behavior: unprefixed tool names, payloads logged, toxic flows only warned.

toxic-flow-auditor: tool names in snake_case are now classified word by word (`read_vault_secret` is sensitive, `drop_table` destructive), and pull requests count as exfiltration. Catalogs may report more findings than before.
