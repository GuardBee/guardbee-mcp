---
"@guardbee/mcp-db-gateway": minor
---

Add optional write support (`insert_row`, `update_row`, `delete_row`) across all three adapters (Prisma, pg, mysql2), off by default behind a new `writesEnabled` kill-switch. Write access requires an explicit opt-in at both the table level (`tableRules[].write`) and, when a role is active, the role level (`roles[].write`) — both must agree. Fields protected by a non-"allow" masking rule (e.g. `tcKimlik`, `passwordHash`) can never be written to. `update_row`/`delete_row` always require a non-empty filter and refuse to touch more rows than `maxAffectedRowsPerWrite` (default 10), checked via a pre-count query before the mutation runs. Every write attempt, accepted or denied, is audit-logged (field names only, never raw values).
