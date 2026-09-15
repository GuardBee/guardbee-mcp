---
"@guardbee/mcp-db-gateway": minor
---

Add a `createSqliteAdapter` for `better-sqlite3` (`Database` instances), alongside the existing Prisma/Postgres/MySQL adapters. Like the `pg`/`mysql2` adapters, table and column identifiers are validated against the live schema (`PRAGMA table_info`) before being embedded in SQL, since they can't be parameterized — an unknown or injection-attempt identifier is rejected before it reaches the database. `better-sqlite3` is an optional peer dependency; nothing changes for consumers who don't use this adapter.

Also exports the `AuditEvent`/`AuditQueryFilter` types from the package root (previously only usable internally) so consumers can type their own calls to `GatewayPipeline.queryAuditLog`.
