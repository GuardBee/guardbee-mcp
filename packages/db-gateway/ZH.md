# @guardbee/mcp-db-gateway

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-db-gateway.svg)](https://www.npmjs.com/package/@guardbee/mcp-db-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Smithery](https://smithery.ai/badge/guardbee/mcp-db-gateway)](https://smithery.ai/servers/guardbee/mcp-db-gateway)

符合 KVKK / GDPR 要求的 MCP（Model Context Protocol）服务器——在 LLM 与数据库之间增加一层安全网关。

Claude（或任何其他 LLM）不再直接查询你的数据库，而是通过本网关。敏感字段会自动脱敏，表访问按角色控制，每一条查询都会写入审计日志。

> 本包默认向 GuardBee 发送使用遥测（工具名 + 较短的参数，例如表名——绝不包含真实行数据/过滤值，见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。这与网关自身的本地审计日志（`audit.filePath`）相互独立。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► MCP Gateway ──► Database
              │
              ├─ PII masking     (tcKimlik → [REDACTED])
              ├─ Role check      (ai-agent can only reach the products table)
              ├─ Rate limiting   (max 100 queries/minute)
              └─ Audit log       (every query is recorded)
```

---

## 功能

- **PII 脱敏** —— 土耳其身份证号、IBAN、邮箱、电话、密码哈希等会自动脱敏
- **基于角色的访问控制（RBAC）** —— 按角色配置表的允许/拒绝列表与字段规则
- **速率限制** —— 全局与按表的请求窗口
- **审计日志** —— 可写入控制台、文件或 HTTP webhook
- **Prisma / Postgres / MySQL / SQLite / MongoDB 适配器** —— 可直接接入已有的 `PrismaClient`、`pg` `Pool`、`mysql2` `Pool`、`better-sqlite3` `Database` 或 MongoDB `Db`
- **写入支持（可选）** —— insert/update/delete，默认关闭；受按表 + 按角色权限、受保护字段守卫，以及“禁止整表操作”安全网约束
- **195 个单元测试** —— 覆盖脱敏、流水线、RBAC、速率限制器、审计日志，以及每个适配器（读 + 写）

---

## 近期变更（2026-09-15）

本包在 AI Gateway 演进中新增了三个步骤：

### 1. `query_audit_log` 工具

此前网关的审计日志是**只写**的——会落到 `console`/`file`/`http` 其中一种 sink，但 Claude 本身无法回头查看“刚才发生了什么、哪些调用被拒绝”。现在可以了：

```typescript
// Tool called from the Claude side:
query_audit_log({ table: "orders", deniedOnly: true, limit: 20 })
```

- **工作原理：** `AuditLogger` 增加了一个始终开启的内存环形缓冲区，与已配置的 sink（`audit.bufferSize`，默认 200）完全独立。即使 sink 是 `"http"`（fire-and-forget webhook），历史仍可通过该缓冲区查询。进程重启后缓冲区会清空；在 `audit.enabled: false` 时不会填充。
- **过滤器：** `table`、`tool`（MCP 工具名，例如 `"delete_row"`）、`operation`（`read`/`insert`/`update`/`delete`）、`deniedOnly`（仅被拒绝的调用）、`since`（ISO 8601 时间戳）、`limit`（默认 50，最大 200）。结果按最新优先返回。
- **顺带修复的真实缺陷：** `registerDbTools`（读工具）与 `registerWriteTools`（写工具）此前各自构建了**自己的** `GatewayPipeline`/`AuditLogger` 实例。这意味着 `insert_row`/`update_row`/`delete_row` 的审计事件**永远不会出现**在 `query_audit_log` 所读的缓冲区里——存在两个互不感知的缓冲区。`server.ts` 现在构建单个 `GatewayPipeline` 实例，并在两组工具间共享。
- **测试：** `src/__tests__/audit-logger.test.ts`（10 个测试——缓冲区上限、每种过滤器、环形缓冲行为），以及向 `pipeline.test.ts` 新增的 3 个测试（验证读写落入同一缓冲区、`deniedOnly` + `table` 过滤器可正确组合，以及在 `audit.enabled: false` 时缓冲区保持为空）。

### 2. SQLite 适配器

网关现在除 Prisma/Postgres/MySQL 外，也支持 `better-sqlite3`：

```typescript
import Database from "better-sqlite3";
import { createServer, createSqliteAdapter } from "@guardbee/mcp-db-gateway";

const db = new Database("./app.db");
const server = createServer({}, createSqliteAdapter(db));
```

- **与 pg/mysql 相同的安全模式：** 表/列名无法参数化，因此在嵌入 SQL 前会先校验——此处使用 SQLite 的 `PRAGMA table_info(table)`，而非 `information_schema`。未通过格式检查的名称（例如 `users"; DROP TABLE users;--`）或不在实时 schema 中的名称，会在任何查询到达 SQLite 之前被拒绝。
- **`better-sqlite3` 仅为可选 `peerDependency`** —— 未加入包自身的 `devDependencies`，因为它需要原生绑定；测试（与 pg/mysql 测试一样）针对匹配 `SqliteQueryable` 接口的简单 mock 对象编写，不导入真实包。
- **insert 使用 `lastInsertRowid` 而非 `RETURNING`：** 由于 SQLite 对 `RETURNING` 的支持取决于版本，此处采用与 MySQL 适配器 `insertId` 相同的做法——若表有 `id` 列且尚未出现在 `data` 中，则把 `lastInsertRowid` 附加到插入的行上。
- **额外修复：** `AuditEvent`/`AuditQueryFilter` 类型此前完全未从包根（`index.ts`）导出——现已添加，方便希望为 `GatewayPipeline.queryAuditLog()` 自建调用做类型标注的消费者。
- **测试：** `src/__tests__/sqlite-adapter.test.ts`（21 个测试）——与 `pg-adapter.test.ts` 相同的场景集：表列表、带/不带过滤的查询、限制、未知表/列拒绝、注入尝试拒绝、insert（含 id 赋值）、update、delete。

### 3. MongoDB 适配器

网关现在也支持来自 `mongodb` 驱动的 `Db` 实例：

```typescript
import { MongoClient } from "mongodb";
import { createServer, createMongoAdapter } from "@guardbee/mcp-db-gateway";

const client = new MongoClient(process.env.DATABASE_URL!);
await client.connect();
const server = createServer({}, createMongoAdapter(client.db("mydb")));
```

- **不同的风险类别——不是 SQL 注入，而是操作符注入：** 对 pg/mysql/sqlite，风险是表/列名被嵌入 SQL。MongoDB 从不嵌入标识符，但若 `filter`/`data` 中的键是 `$where`/`$ne` 这类 Mongo 操作符，或值是像 `{ $ne: null }` 这样的操作符对象，工具声明的“简单键值相等过滤”可能悄悄变成任意查询。本适配器会预先拒绝以下全部情况：
  - 任何以 `$` 开头的键（在 `filter` 与 `data` 中均如此）
  - 任何包含 `.` 的键——点分路径（例如 `"passwordHash.reset"`）既像操作符风险，也能绕过 `findProtectedWriteFields` 的精确名称匹配（在其 glob 支持之外）
  - 任何非标量（对象/数组）过滤值——包括像 `{ status: { $ne: "active" } }` 这样的操作符对象绕过尝试
- **`mongodb` 仅为可选 `peerDependency`** —— 与 SQLite 适配器相同，测试针对匹配 `MongoDatabase` 接口的 mock 对象编写，不导入真实包。
- **“表”= collection。** `tables()` 映射到 `listCollections()`；insert 将驱动的 `insertedId` 作为 `_id` 附加到返回行；update 以 `{ $set: data }` 运行 `updateMany`；delete 运行 `deleteMany`。
- **测试：** `src/__tests__/mongo-adapter.test.ts`（19 个测试）—— collection 列表、带/不带过滤的查询、限制、三种操作符注入场景（`$` 前缀键、点分键、操作符对象值）、insert/update/delete。

---

## 快速开始

### 1. 通过 Smithery 一键连接

你可以通过 [Smithery](https://smithery.ai/servers/guardbee/mcp-db-gateway) 一键将其添加到 Claude Desktop。

### 2. 通过全局安装连接到 Claude Desktop

```bash
npm install -g @guardbee/mcp-db-gateway
```

添加到 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）：

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

> **Windows：** `%APPDATA%\Claude\claude_desktop_config.json`
> **Linux：** `~/.config/Claude/claude_desktop_config.json`

重启 Claude Desktop。演示数据库会自动加载，PII 脱敏处于启用状态。

### 3. 在项目中使用（Prisma）

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

若未使用 Prisma，也可以直接传入原始的 `pg` 或 `mysql2` 连接：

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

> **安全说明：** 与 Prisma 适配器不同，`pg`/`mysql2`/`better-sqlite3` 适配器会生成原始 SQL。由于表名和列名无法参数化，每次查询都会对照实时 schema 校验（`information_schema`，SQLite 则为 `PRAGMA table_info`）——不在 schema 中的表/列名（例如注入尝试）会在到达 SQL 之前被拒绝。MongoDB 适配器防范的是另一类风险（“操作符注入”而非 SQL）——见[近期变更](#近期变更2026-09-15)。

---

## MCP 工具

网关始终向 Claude 暴露这 5 个读工具：

| 工具 | 说明 |
|------|----------|
| `query_table` | 从表中查询行（PII 自动脱敏） |
| `list_tables` | 列出可访问的表（应用角色限制） |
| `describe_table` | 显示表的 schema 与脱敏策略 |
| `query_audit_log` | 查询网关自身的审计历史（可按 table/tool/operation/deniedOnly/since 过滤）——内存中，受 `audit.bufferSize` 限制，进程重启后清空 |
| `gateway_status` | 显示当前配置、角色与速率限制状态 |

当 `writesEnabled: true` 时（见[写入支持](#写入支持-writeinsertupdatedelete)），还会增加 3 个写工具：

| 工具 | 说明 |
|------|----------|
| `insert_row` | 插入新行 |
| `update_row` | 更新匹配过滤条件的行（空过滤会被拒绝） |
| `delete_row` | 删除匹配过滤条件的行（空过滤会被拒绝） |

---

## 配置

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

## 脱敏策略

| 策略 | 说明 | 示例 |
|----------|----------|-------|
| `redact` | 字段被完全移除 | `[REDACTED]` |
| `mask` | 值的中间部分用星号遮盖 | `ah***@example.com` / `530***67` |
| `hash` | SHA-256（前 16 个字符） | `a665a45920422f9d` |
| `allow` | 原样通过 | `ahmet@example.com` |

支持 glob 模式：`*Password*`、`*Token*`、`*Secret*`

---

## 基于角色的访问控制（RBAC）

角色在服务器启动时通过 `GATEWAY_ROLE` 环境变量或 `config.activeRole` 设置。
每个 Claude Desktop 配置或部署可以以不同角色运行。

```bash
GATEWAY_ROLE=analyst node dist/cli.js
```

**规则优先级（从高到低）：**
1. 全局 `tableRules` deny
2. 角色 `denyTables`
3. 角色 `allowTables`（白名单——若已设置，表必须在此列表中）
4. 角色 `fieldRules` → 全局 `fieldRules`

---

## 写入支持（write/insert/update/delete）

网关默认**完全只读**。若要让 LLM 修改数据，需要刻意解锁几道闸门：

1. **`writesEnabled: true`** —— 全局总开关。在 `false`（默认）时，`insert_row`/`update_row`/`delete_row` 对 Claude 不可见。
2. **表权限** —— `tableRules[].write.{insert,update,delete}` —— 按表配置，默认全部关闭。
3. **角色权限**（当有活动角色时）—— `roles[].write.{insert,update,delete}`。若角色从未定义 `write`（undefined），则该角色完全禁止写入——即使表允许。要允许写入，**表与角色都必须**显式设为 `true`（AND 逻辑——刻意比脱敏规则使用的“角色覆盖”逻辑更严格）。

在这三道闸门之外，还有两项无法关闭的保护：

- **受保护字段守卫** —— LLM 永远不能向 `fieldRules` 中标记为 `redact`/`mask`/`hash` 的字段写入值（例如 `tcKimlik`、`passwordHash`）；若 `insert_row`/`update_row` 在 `data` 中看到此类字段，整个请求会被拒绝。
- **`maxAffectedRowsPerWrite`** —— 在 `update_row`/`delete_row` 运行前，过滤条件会先作为读查询试跑；若匹配行数超过此限制（默认 10），操作会在触碰任何数据之前被拒绝。`update_row`/`delete_row` 也**始终拒绝空过滤**——通过本网关永远不可能“更新/删除整张表”。

每一次写入尝试（无论接受或拒绝）都会写入审计日志；仅记录写入了哪些字段，从不记录 `data` 本身（因此审计日志本身不会成为 PII 泄露点）。

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

## Prisma 适配器

直接传入 `PrismaClient` —— 表名 → 模型映射是自动的：

| 查询表 | Prisma 模型 |
|---------------|---------------|
| `"users"` | `prisma.user` |
| `"audit_logs"` | `prisma.auditLog` |
| `"orders"` | `prisma.order` |
| `"orderItems"` | `prisma.orderItem` |

---

## 开发

```bash
npm run dev          # dev mode via tsx
npm run build        # TypeScript compile
npm test             # 195 unit tests
npm run test:watch   # watch mode
npm run type-check   # type-check only
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
