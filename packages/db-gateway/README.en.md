# @guardbee/mcp-db-gateway

[🇹🇷 Türkçe](README.md) | **🇬🇧 English**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Smithery](https://smithery.ai/badge/guardbee/mcp-db-gateway)](https://smithery.ai/servers/guardbee/mcp-db-gateway)

A KVKK / GDPR-compliant MCP (Model Context Protocol) server — adds a security layer between an LLM and a database.

Instead of querying your database directly, Claude (or any other LLM) goes through this gateway. Sensitive fields are masked automatically, table access is role-controlled, and every query is written to an audit log.

> This package sends usage telemetry to GuardBee by default (tool name + short parameters, e.g. a table name — real row data/filter values are never included, see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). This is separate from and independent of the gateway's own local audit log (`audit.filePath`). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► MCP Gateway ──► Database
              │
              ├─ PII masking     (tcKimlik → [REDACTED])
              ├─ Role check      (ai-agent can only reach the products table)
              ├─ Rate limiting   (max 100 queries/minute)
              └─ Audit log       (every query is recorded)
```

---

## Features

- **PII Masking** — Turkish national ID, IBAN, email, phone, password hashes, etc. are masked automatically
- **Role-Based Access (RBAC)** — Per-role table allow/deny lists and field rules
- **Rate Limiting** — Global and per-table request windows
- **Audit Log** — Writable to console, a file, or an HTTP webhook
- **Prisma / Postgres / MySQL / SQLite / MongoDB Adapters** — Plug in an existing `PrismaClient`, a `pg` `Pool`, a `mysql2` `Pool`, a `better-sqlite3` `Database`, or a MongoDB `Db` directly
- **Write Support (optional)** — insert/update/delete, off by default; gated by per-table + per-role permission, protected-field guarding, and a "don't touch the whole table" safety net
- **193 unit tests** — masking, the pipeline, RBAC, the rate limiter, the audit log, and every adapter (read + write) are covered

---

## Recent Changes (2026-09-15)

Three new steps in this package's AI Gateway growth work:

### 1. The `query_audit_log` tool

Previously the gateway's audit log was **write-only** — it landed in one of the `console`/`file`/`http` sinks, but Claude itself had no way to look back and ask "what just happened, which calls got denied." Now it can:

```typescript
// Tool called from the Claude side:
query_audit_log({ table: "orders", deniedOnly: true, limit: 20 })
```

- **How it works:** `AuditLogger` gained an always-on, in-memory ring buffer that's completely independent of the configured sink (`audit.bufferSize`, default 200). Even when the sink is `"http"` (a fire-and-forget webhook), history is still queryable through this buffer. The buffer resets when the process restarts, and is never populated while `audit.enabled: false`.
- **Filters:** `table`, `tool` (the MCP tool name, e.g. `"delete_row"`), `operation` (`read`/`insert`/`update`/`delete`), `deniedOnly` (denied calls only), `since` (an ISO 8601 timestamp), `limit` (default 50, max 200). Results come back newest-first.
- **A real bug fixed along the way:** `registerDbTools` (read tools) and `registerWriteTools` (write tools) previously each built **their own** `GatewayPipeline`/`AuditLogger` instance. That meant audit events from `insert_row`/`update_row`/`delete_row` calls would **never have appeared** in the buffer that `query_audit_log` reads — there were two separate, unaware-of-each-other buffers. `server.ts` now builds a single `GatewayPipeline` instance and shares it across both tool groups.
- **Tests:** `src/__tests__/audit-logger.test.ts` (10 tests — buffer capping, every filter, ring-buffer behavior) plus 3 tests added to `pipeline.test.ts` (verifying that reads and writes land in the same buffer, that `deniedOnly` + `table` filters compose correctly, and that the buffer stays empty while `audit.enabled: false`).

### 2. The SQLite adapter

The gateway now works with `better-sqlite3` alongside Prisma/Postgres/MySQL:

```typescript
import Database from "better-sqlite3";
import { createServer, createSqliteAdapter } from "@guardbee/mcp-db-gateway";

const db = new Database("./app.db");
const server = createServer({}, createSqliteAdapter(db));
```

- **Same security pattern as pg/mysql:** table/column names can't be parameterized, so they're validated before being embedded in SQL — here using SQLite's `PRAGMA table_info(table)` instead of `information_schema`. A name that fails the format check (e.g. `users"; DROP TABLE users;--`) or isn't in the live schema is rejected before any query reaches SQLite.
- **`better-sqlite3` is only an optional `peerDependency`** — it was not added to the package's own `devDependencies`, since it requires a native binding; tests (like the pg/mysql tests) were written against a simple mock object matching the `SqliteQueryable` interface, without importing the real package.
- **`lastInsertRowid` instead of `RETURNING` for insert:** since SQLite's `RETURNING` support is version-dependent, this follows the same approach as the MySQL adapter's `insertId` — if the table has an `id` column and it's not already in `data`, the inserted row gets `lastInsertRowid` attached.
- **Bonus fix:** the `AuditEvent`/`AuditQueryFilter` types were not exported from the package root (`index.ts`) at all — added for consumers who want to type their own calls to `GatewayPipeline.queryAuditLog()`.
- **Tests:** `src/__tests__/sqlite-adapter.test.ts` (21 tests) — the same scenario set as `pg-adapter.test.ts`: table listing, filtered/unfiltered queries, limits, unknown table/column rejection, injection-attempt rejection, insert (including id assignment), update, delete.

### 3. The MongoDB adapter

The gateway now also works with a `Db` instance from the `mongodb` driver:

```typescript
import { MongoClient } from "mongodb";
import { createServer, createMongoAdapter } from "@guardbee/mcp-db-gateway";

const client = new MongoClient(process.env.DATABASE_URL!);
await client.connect();
const server = createServer({}, createMongoAdapter(client.db("mydb")));
```

- **A different risk class — not SQL injection, but operator injection:** for pg/mysql/sqlite the risk was a table/column name being embedded in SQL. MongoDB never embeds identifiers, but if a key in `filter`/`data` is a Mongo operator like `$where`/`$ne`, or a value is an operator object like `{ $ne: null }`, the "simple key-value equality filter" a tool declares can silently turn into an arbitrary query. This adapter rejects all of the following up front:
  - any key starting with `$` (in both `filter` and `data`)
  - any key containing `.` — a dotted path (e.g. `"passwordHash.reset"`) is both an operator-like risk and a way to bypass `findProtectedWriteFields`'s exact-name matching (outside of its glob support)
  - any non-scalar (object/array) filter value — including an operator-object bypass attempt like `{ status: { $ne: "active" } }`
- **`mongodb` is only an optional `peerDependency`** — same as the SQLite adapter, tests were written against a mock object matching the `MongoDatabase` interface, without importing the real package.
- **"Table" = collection.** `tables()` maps to `listCollections()`; insert attaches `_id` (the driver's `insertedId`) to the returned row; update runs `updateMany` with `{ $set: data }`; delete runs `deleteMany`.
- **Tests:** `src/__tests__/mongo-adapter.test.ts` (19 tests) — collection listing, filtered/unfiltered queries, limits, three operator-injection scenarios (a `$`-prefixed key, a dotted key, an operator-object value), insert/update/delete.

---

## Quick Start

### 1. Connect with one click via Smithery

You can add this to Claude Desktop with one click via [Smithery](https://smithery.ai/servers/guardbee/mcp-db-gateway).

### 2. Connect to Claude Desktop via global install

```bash
npm install -g @guardbee/mcp-db-gateway
```

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "guardbee-db-gateway": {
      "command": "guardbee-gateway",
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/mydb"
      }
    }
  }
}
```

> **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
> **Linux:** `~/.config/Claude/claude_desktop_config.json`

Restart Claude Desktop. The demo database loads automatically, with PII masking active.

### 3. Use it in your project (Prisma)

```bash
npm install @guardbee/mcp-db-gateway
```

```typescript
import { PrismaClient } from "@prisma/client";
import { createServer, createPrismaAdapter } from "@guardbee/mcp-db-gateway";

const prisma = new PrismaClient();

const server = createServer(
  {
    audit: { enabled: true, sink: "file", filePath: "./audit.jsonl" },
  },
  createPrismaAdapter(prisma)
);
```

If you don't use Prisma, you can also pass a raw `pg` or `mysql2` connection directly:

```typescript
// Postgres
import { Pool } from "pg";
import { createServer, createPgAdapter } from "@guardbee/mcp-db-gateway";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const server = createServer({}, createPgAdapter(pool /*, { schema: "public" } */));
```

```typescript
// MySQL
import mysql from "mysql2/promise";
import { createServer, createMysqlAdapter } from "@guardbee/mcp-db-gateway";

const pool = mysql.createPool(process.env.DATABASE_URL!);
const server = createServer({}, createMysqlAdapter(pool /*, { database: "shop" } */));
```

```typescript
// SQLite
import Database from "better-sqlite3";
import { createServer, createSqliteAdapter } from "@guardbee/mcp-db-gateway";

const db = new Database("./app.db");
const server = createServer({}, createSqliteAdapter(db));
```

```typescript
// MongoDB
import { MongoClient } from "mongodb";
import { createServer, createMongoAdapter } from "@guardbee/mcp-db-gateway";

const client = new MongoClient(process.env.DATABASE_URL!);
await client.connect();
const server = createServer({}, createMongoAdapter(client.db("mydb")));
```

> **Security note:** unlike the Prisma adapter, the `pg`/`mysql2`/`better-sqlite3` adapters generate raw SQL. Because table and column names can't be parameterized, they are validated against the live schema on every query (`information_schema`, or `PRAGMA table_info` for SQLite) — a table/column name that isn't in the schema (e.g. an injection attempt) is rejected before it ever reaches SQL. The MongoDB adapter guards against a different risk ("operator injection" instead of SQL) — see [Recent Changes](#recent-changes-2026-09-15).

---

## MCP Tools

The gateway always exposes these 5 read tools to Claude:

| Tool | Description |
|------|----------|
| `query_table` | Query rows from a table (PII is masked automatically) |
| `list_tables` | List accessible tables (role restrictions applied) |
| `describe_table` | Show a table's schema and masking policy |
| `query_audit_log` | Query the gateway's own audit history (filterable by table/tool/operation/deniedOnly/since) — in-memory, capped by `audit.bufferSize`, resets on process restart |
| `gateway_status` | Show the active config, roles, and rate-limit status |

When `writesEnabled: true` (see [Write Support](#write-support-writeinsertupdatedelete)), 3 more write tools are added:

| Tool | Description |
|------|----------|
| `insert_row` | Inserts a new row |
| `update_row` | Updates rows matching a filter (an empty filter is rejected) |
| `delete_row` | Deletes rows matching a filter (an empty filter is rejected) |

---

## Configuration

```typescript
createServer({
  // PII field rules (the first match applies)
  fieldRules: [
    { field: "tcKimlik",     strategy: "redact" }, // [REDACTED]
    { field: "iban",         strategy: "mask"   }, // TR32***890
    { field: "email",        strategy: "mask"   }, // ah***@example.com
    { field: "passwordHash", strategy: "redact" },
    { field: "*Token*",      strategy: "redact" }, // glob pattern
  ],

  // Table access rules
  tableRules: [
    { table: "audit_logs", access: "deny"  },
    { table: "users",      access: "allow", maxRows: 25 },
    // write: if unspecified, that table has no write permission at all (off by default)
    { table: "orders",     access: "allow", write: { insert: true, update: true, delete: false } },
  ],

  // Turn on the write tools (insert_row/update_row/delete_row) — false by default.
  // While false, these tools are never visible to Claude.
  writesEnabled: true,

  // How many rows update_row/delete_row may affect via one filter.
  // If exceeded, the operation is rejected before touching the database ("narrow your filter").
  maxAffectedRowsPerWrite: 10,

  // Default max rows
  defaultMaxRows: 50,

  // Rate limiting
  rateLimit: {
    enabled: true,
    windowMs: 60_000,          // 1 minute
    maxRequests: 100,           // global limit
    maxRequestsPerTable: 20,    // per table
  },

  // Audit log
  audit: {
    enabled: true,
    sink: "file",              // "console" | "file" | "http"
    filePath: "./audit.jsonl",
    // webhookUrl: "https://..."  (for sink: "http")
    bufferSize: 200,           // size of the in-memory history the `query_audit_log` tool reads
  },

  // Roles
  roles: [
    {
      name: "ai-agent",
      allowTables: ["products", "orders"],  // only these tables
      maxRows: 10,
      // If a role doesn't define write (undefined), write is COMPLETELY off for that role,
      // even if the table allows it. To permit writes, state it explicitly on the role too:
      write: { insert: true, update: true, delete: false },
    },
    {
      name: "analyst",
      denyTables: ["audit_logs"],           // this table is blocked
      fieldRules: [
        { field: "email", strategy: "allow" }, // email unmasked
      ],
      // write not defined → analyst can write nothing
    },
  ],

  // Active role (can also be set via the GATEWAY_ROLE env var)
  activeRole: "ai-agent",
});
```

---

## Masking Strategies

| Strategy | Description | Example |
|----------|----------|-------|
| `redact` | The field is removed entirely | `[REDACTED]` |
| `mask` | The middle of the value is starred out | `ah***@example.com` / `530***67` |
| `hash` | SHA-256 (first 16 characters) | `a665a45920422f9d` |
| `allow` | Passed through unchanged | `ahmet@example.com` |

Glob pattern support: `*Password*`, `*Token*`, `*Secret*`

---

## Role-Based Access (RBAC)

The role is set when the server starts, via the `GATEWAY_ROLE` env var or `config.activeRole`.
Each Claude Desktop profile or deployment can run with a different role.

```bash
GATEWAY_ROLE=analyst node dist/cli.js
```

**Rule precedence (highest to lowest):**
1. Global `tableRules` deny
2. Role `denyTables`
3. Role `allowTables` (a whitelist — if set, the table must be in this list)
4. Role `fieldRules` → global `fieldRules`

---

## Write Support (write/insert/update/delete)

The gateway is **fully read-only** by default. Letting the LLM modify data requires deliberately unlocking a few gates:

1. **`writesEnabled: true`** — the global kill-switch. While `false` (default), `insert_row`/`update_row`/`delete_row` are never visible to Claude.
2. **Table permission** — `tableRules[].write.{insert,update,delete}` — per table, off by default for all.
3. **Role permission** (when a role is active) — `roles[].write.{insert,update,delete}`. If a role never defines `write` (undefined), write is completely off for that role — even if the table permits it. To permit a write, **both the table and the role** must explicitly say `true` (AND logic — deliberately stricter than the "role overrides" logic used for masking rules).

Beyond these three gates, there are two more protections that cannot be disabled:

- **Protected-field guarding** — the LLM can never write a value into a field marked `redact`/`mask`/`hash` in `fieldRules` (e.g. `tcKimlik`, `passwordHash`); if `insert_row`/`update_row` sees such a field in `data`, the whole request is rejected.
- **`maxAffectedRowsPerWrite`** — before `update_row`/`delete_row` runs, the filter is first tried as a read; if the matched row count exceeds this limit (default 10), the operation is rejected before touching anything. `update_row`/`delete_row` also **always reject an empty filter** — "update/delete the whole table" is never possible through this gateway.

Every write attempt (accepted or denied) is written to the audit log; only which fields were written is logged, never `data` itself (so the audit log itself can't become a PII leak point).

```typescript
createServer({
  writesEnabled: true,
  maxAffectedRowsPerWrite: 10,
  tableRules: [
    { table: "orders", access: "allow", write: { insert: true, update: true, delete: false } },
  ],
  roles: [
    { name: "ai-agent", allowTables: ["orders"], write: { insert: true, update: true, delete: false } },
  ],
  activeRole: "ai-agent",
});
```

---

## Prisma Adapter

Pass a `PrismaClient` directly — table name → model mapping is automatic:

| Query table | Prisma model |
|---------------|---------------|
| `"users"` | `prisma.user` |
| `"audit_logs"` | `prisma.auditLog` |
| `"orders"` | `prisma.order` |
| `"orderItems"` | `prisma.orderItem` |

---

## Development

```bash
npm run dev          # dev mode via tsx
npm run build        # TypeScript compile
npm test             # 193 unit tests
npm run test:watch   # watch mode
npm run type-check   # type-check only
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
