---
"@guardbee/mcp-db-gateway": minor
---

Add a `query_audit_log` tool that lets the LLM (or an operator) inspect the gateway's own audit history — filterable by `table`, `tool`, `operation`, `deniedOnly`, and `since`. Backed by an always-on in-memory ring buffer (size controlled by the new `audit.bufferSize` config field, default 200) that is independent of the configured sink (`console`/`file`/`http`), so history is queryable even when the sink is fire-and-forget (e.g. a webhook). The buffer resets on process restart and only records events while `audit.enabled` is true.

Also fixes a bug where read tools (`query_table`, etc.) and write tools (`insert_row`/`update_row`/`delete_row`) each built their own `GatewayPipeline`/`AuditLogger` instance — write events would never have appeared in `query_audit_log` results. The server now shares a single pipeline instance across both tool groups.
