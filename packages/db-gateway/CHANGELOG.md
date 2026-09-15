# @guardbee/mcp-db-gateway

## 0.3.1

### Patch Changes

- Make the English README the primary `README.md` (what npm and GitHub display by default) and move the Turkish version to `README.tr.md`, linked via a language switcher at the top of each. Docs-only change, no code/behavior changes.

## 0.3.0

### Minor Changes

- [`9845c94`](https://github.com/GuardBee/guardbee-mcp/commit/9845c948b312c0295b896449247b130eb8a70ba7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add a `createMongoAdapter` for the `mongodb` driver's `Db` type, alongside the Prisma/Postgres/MySQL/SQLite adapters ("table" maps to a collection). Unlike the SQL adapters — where the risk is table/column identifiers being embedded in raw SQL — MongoDB never embeds identifiers, but a `filter`/`data` key that is a Mongo operator (`$where`, `$ne`, ...) or a filter value that is an operator object (`{ $ne: null }`) can silently turn a tool's declared "simple equality filter" into an arbitrary query. This adapter rejects any `$`-prefixed key, any dotted-path key (which could also bypass the field-protection check's exact-name matching), and any non-scalar filter value, before the query ever reaches MongoDB. `mongodb` is an optional peer dependency only; nothing changes for consumers who don't use this adapter.

- [`30ffd08`](https://github.com/GuardBee/guardbee-mcp/commit/30ffd08837d6da90e7b8e91d1649a87748bd083e) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add a `query_audit_log` tool that lets the LLM (or an operator) inspect the gateway's own audit history — filterable by `table`, `tool`, `operation`, `deniedOnly`, and `since`. Backed by an always-on in-memory ring buffer (size controlled by the new `audit.bufferSize` config field, default 200) that is independent of the configured sink (`console`/`file`/`http`), so history is queryable even when the sink is fire-and-forget (e.g. a webhook). The buffer resets on process restart and only records events while `audit.enabled` is true.
  
  Also fixes a bug where read tools (`query_table`, etc.) and write tools (`insert_row`/`update_row`/`delete_row`) each built their own `GatewayPipeline`/`AuditLogger` instance — write events would never have appeared in `query_audit_log` results. The server now shares a single pipeline instance across both tool groups.

- [`2c92c8a`](https://github.com/GuardBee/guardbee-mcp/commit/2c92c8a9aff8abf62de9790cd0ce50b503994f28) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add a `createSqliteAdapter` for `better-sqlite3` (`Database` instances), alongside the existing Prisma/Postgres/MySQL adapters. Like the `pg`/`mysql2` adapters, table and column identifiers are validated against the live schema (`PRAGMA table_info`) before being embedded in SQL, since they can't be parameterized — an unknown or injection-attempt identifier is rejected before it reaches the database. `better-sqlite3` is an optional peer dependency; nothing changes for consumers who don't use this adapter.
  
  Also exports the `AuditEvent`/`AuditQueryFilter` types from the package root (previously only usable internally) so consumers can type their own calls to `GatewayPipeline.queryAuditLog`.

- [`cd0a849`](https://github.com/GuardBee/guardbee-mcp/commit/cd0a849c0057a2e4e3c0c87e59eca4f19e0db958) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add optional write support (`insert_row`, `update_row`, `delete_row`) across all three adapters (Prisma, pg, mysql2), off by default behind a new `writesEnabled` kill-switch. Write access requires an explicit opt-in at both the table level (`tableRules[].write`) and, when a role is active, the role level (`roles[].write`) — both must agree. Fields protected by a non-"allow" masking rule (e.g. `tcKimlik`, `passwordHash`) can never be written to. `update_row`/`delete_row` always require a non-empty filter and refuse to touch more rows than `maxAffectedRowsPerWrite` (default 10), checked via a pre-count query before the mutation runs. Every write attempt, accepted or denied, is audit-logged (field names only, never raw values).

- [`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add usage telemetry via the new `@guardbee/mcp-telemetry` shared package — **on by default**, disable with `GUARDBEE_TELEMETRY=0`. Every tool call reports the tool name, a shape-preserving-redacted version of its parameters, success/failure, and duration to `app.guardbee.ai`.
  
  Redaction (`redactParams`, see `@guardbee/mcp-telemetry`'s README) replaces any string longer than 40 characters, and the value of any `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` key regardless of length, with a `"[redacted: ...]"` placeholder — full file/scan content and real row data are never sent, only short structural parameters like table names or limits. A one-time notice is printed to stderr on first use explaining this and how to opt out. This is a behavior change (these packages now make an outbound network call by default) — previously most of them advertised running entirely offline.

## 0.2.0

### Minor Changes

- [`6ff3250`](https://github.com/GuardBee/guardbee-mcp/commit/6ff3250425a9da981f559596dc7c42ffa67ce3a3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add `createPgAdapter` (node-postgres) and `createMysqlAdapter` (mysql2) alongside the existing Prisma adapter, so the gateway works without an ORM. Both validate table and column identifiers against the live schema via `information_schema` before building parameterized SQL, since identifiers can't be parameterized directly — this closes off the injection path a naive raw-SQL adapter would otherwise have.
