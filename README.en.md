# guardbee-mcp

[🇹🇷 Türkçe](README.md) | **🇬🇧 English**

GuardBee's family of MCP (Model Context Protocol) servers — a single monorepo, independent npm packages.

## Packages

| Package | npm | Description |
|---|---|---|
| [`packages/ai-code-scanner`](packages/ai-code-scanner) | `@guardbee/mcp-ai-code-scanner` | Scans a codebase for insecure LLM/AI integration patterns (client-exposed keys, unsafe output handling, excessive agency, PII→prompt, prompt injection) |
| [`packages/compliance-checker`](packages/compliance-checker) | `@guardbee/mcp-compliance-checker` | KVKK/GDPR/CCPA compliance checks |
| [`packages/dependency-auditor`](packages/dependency-auditor) | `@guardbee/mcp-dependency-auditor` | CVE scanning for npm/pip/cargo dependencies (OSV) |
| [`packages/dns-intelligence`](packages/dns-intelligence) | `@guardbee/mcp-dns-intelligence` | DNS record enumeration, misconfiguration and dangling-subdomain detection |
| [`packages/db-gateway`](packages/db-gateway) | `@guardbee/mcp-db-gateway` | KVKK/GDPR-compliant gateway between an LLM and a database (PII masking, RBAC, rate limiting, queryable audit log; Prisma/Postgres/MySQL/SQLite adapters; optional insert/update/delete support) |
| [`packages/secret-scanner`](packages/secret-scanner) | `@guardbee/mcp-secret-scanner` | Scans files for leaked secrets and API keys |
| [`packages/security-proxy`](packages/security-proxy) | `@guardbee/mcp-security-proxy` | Security proxy between an MCP client and server |
| [`packages/security-suite`](packages/security-suite) | `@guardbee/security-suite` | Bundle of secret-scanner + dependency-auditor + ssl-inspector + dns-intelligence |
| [`packages/ssl-inspector`](packages/ssl-inspector) | `@guardbee/mcp-ssl-inspector` | TLS certificate/cipher/protocol inspection |
| [`packages/vulnerability-scanner`](packages/vulnerability-scanner) | `@guardbee/mcp-vulnerability-scanner` | Triggers GuardBee scans, queries findings, AI-assisted remediation guidance |
| [`packages/telemetry`](packages/telemetry) | `@guardbee/mcp-telemetry` | (internal) Shared usage-telemetry client — not an MCP server on its own |

## Recent Changes (2026-09-15)

Continued growing the AI Gateway (`db-gateway`) work:

- **`query_audit_log` tool** — the gateway's own audit history is now queryable, filterable by `table`/`tool`/`operation`/`deniedOnly`/`since`. It reads from an always-on in-memory ring buffer (`audit.bufferSize`, default 200) that is independent of the configured sink (console/file/http). This also fixed a bug where read and write tools each built their own `AuditLogger`, so write events would never have shown up in query results.
- **SQLite adapter** — `createSqliteAdapter` accepts a `better-sqlite3` `Database` instance, following the same pattern as the `pg`/`mysql2` adapters (identifiers validated against the live schema via `PRAGMA table_info` before being embedded in SQL).

Full write-up: [`packages/db-gateway/README.en.md#recent-changes-2026-09-15`](packages/db-gateway/README.en.md#recent-changes-2026-09-15).

## Telemetry

Every package sends usage telemetry to GuardBee via `@guardbee/mcp-telemetry`, **enabled by default**: which tool is called, how often, and how long it takes. A one-time notice is printed to stderr on first use.

- **To disable**: `GUARDBEE_TELEMETRY=0` (or `false`/`off`)
- **What's sent**: tool name, short (≤40 character) parameter values (e.g. `table: "users"`, `limit: 50`), success/failure, duration
- **What's NEVER sent**: values under keys like `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`, and any string longer than 40 characters — all replaced with `"[redacted: ...]"` by `redactParams()` in `packages/telemetry/src/redact.ts`. So the full content of scanned files/code, or the real row data from an `insert_row`/`update_row` call, is never sent.

Details: [`packages/telemetry/README.md`](packages/telemetry/README.md).

## Development

```
pnpm install
pnpm build     # turbo run build — all packages, in dependency order
pnpm test      # turbo run test
```

To work on a single package:

```
pnpm --filter @guardbee/mcp-ssl-inspector dev
```

## Versioning and publishing

Packages are versioned independently ([Changesets](https://github.com/changesets/changesets)). If you changed something in a PR:

```
pnpm changeset
```

After merging to `main`, CI automatically opens a version PR; merging that PR publishes the changed packages to npm (see `.github/workflows/release.yml`).

## Structure

- **pnpm workspaces** — `packages/*`, real `workspace:*` dependencies (e.g. `security-suite` depends on the other 4 packages directly from the workspace, not a registry version)
- **Turborepo** — `build`/`test`/`type-check` pipeline, dependency-graph-aware ordering and caching
- **Shared config** — `tsconfig.base.json` and `vitest.shared.ts` at the root; each package layers its own settings on top
