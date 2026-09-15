---
"@guardbee/mcp-db-gateway": minor
---

Add a `createMongoAdapter` for the `mongodb` driver's `Db` type, alongside the Prisma/Postgres/MySQL/SQLite adapters ("table" maps to a collection). Unlike the SQL adapters — where the risk is table/column identifiers being embedded in raw SQL — MongoDB never embeds identifiers, but a `filter`/`data` key that is a Mongo operator (`$where`, `$ne`, ...) or a filter value that is an operator object (`{ $ne: null }`) can silently turn a tool's declared "simple equality filter" into an arbitrary query. This adapter rejects any `$`-prefixed key, any dotted-path key (which could also bypass the field-protection check's exact-name matching), and any non-scalar filter value, before the query ever reaches MongoDB. `mongodb` is an optional peer dependency only; nothing changes for consumers who don't use this adapter.
