# @guardbee/mcp-db-gateway

## 0.2.0

### Minor Changes

- [`6ff3250`](https://github.com/GuardBee/guardbee-mcp/commit/6ff3250425a9da981f559596dc7c42ffa67ce3a3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add `createPgAdapter` (node-postgres) and `createMysqlAdapter` (mysql2) alongside the existing Prisma adapter, so the gateway works without an ORM. Both validate table and column identifiers against the live schema via `information_schema` before building parameterized SQL, since identifiers can't be parameterized directly — this closes off the injection path a naive raw-SQL adapter would otherwise have.
