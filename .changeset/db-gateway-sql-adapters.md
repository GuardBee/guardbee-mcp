---
"@guardbee/mcp-db-gateway": minor
---

Add `createPgAdapter` (node-postgres) and `createMysqlAdapter` (mysql2) alongside the existing Prisma adapter, so the gateway works without an ORM. Both validate table and column identifiers against the live schema via `information_schema` before building parameterized SQL, since identifiers can't be parameterized directly — this closes off the injection path a naive raw-SQL adapter would otherwise have.
