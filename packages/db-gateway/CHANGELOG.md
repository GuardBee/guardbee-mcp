# @guardbee/mcp-db-gateway

## 0.6.1

### Patch Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.

## 0.6.0

### Minor Changes

- [#185](https://github.com/GuardBee/guardbee-mcp/pull/185) [`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `mcp-security-proxy` and `mcp-db-gateway` get an `exports` map (the package root, `./dist/*` for existing deep imports, `package.json`); db-gateway also exports `./adapters/*`, so the documented `import { createPrismaAdapter } from "@guardbee/mcp-db-gateway/adapters/prisma"` now resolves. The proxy moves to ldapts 9 (its older uuid had an advisory). The telemetry package description now says opt-in, the suite's starts with "MCP security suite", and document-scanner's homepage is its README.

### Patch Changes

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-telemetry@0.3.0
  - @guardbee/guard-core@1.0.1

## 0.5.5

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395), [`c3b71f8`](https://github.com/GuardBee/guardbee-mcp/commit/c3b71f8e1305cbabe0fa733b13f6eb9a95d08513)]:
  - @guardbee/guard-core@1.0.0
  - @guardbee/mcp-telemetry@0.2.0

## 0.5.4

### Patch Changes

- Updated dependencies [[`9599fb6`](https://github.com/GuardBee/guardbee-mcp/commit/9599fb64249dc38baba3fd4b2d1d7fb82dfd6de3)]:
  - @guardbee/guard-core@0.22.0

## 0.5.3

### Patch Changes

- Updated dependencies [[`c1a16b9`](https://github.com/GuardBee/guardbee-mcp/commit/c1a16b9c9f588c4d3735fb45a1339b33119a8de0)]:
  - @guardbee/guard-core@0.21.0

## 0.5.2

### Patch Changes

- Updated dependencies [[`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16)]:
  - @guardbee/guard-core@0.20.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0

## 0.5.0

### Minor Changes

- [#148](https://github.com/GuardBee/guardbee-mcp/pull/148) [`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Org-level PII patterns. `blockPatterns` mask an organization's own identifiers as numbered placeholders (`<CLIENT_NO_1>`); `allowPatterns` leave a detected value unmasked and are flagged in the audit log. Each pattern runs with a time budget: a block pattern over budget fails closed (result withheld, LLM gateway 502), an allow pattern over budget is skipped. Max 25 patterns of 200 characters; invalid regexes and categories named like built-in detectors fail validation. An LLM gateway request can add block patterns (`guardbee.blockPatterns`) but never allow patterns.

### Patch Changes

- Updated dependencies [[`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548)]:
  - @guardbee/guard-core@0.18.0

## 0.4.0

### Minor Changes

- [#146](https://github.com/GuardBee/guardbee-mcp/pull/146) [`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - PII category presets. guard-core exports `PII_PRESETS` (`ALL`, `KVKK`, `IDENTITY`, `IDENTIFIERS`, `SECRETS`), `piiScope({ preset, enable, disable })` and a config schema that rejects unknown preset or detector names. security-proxy takes `interceptors.piiMasking.preset` / `enable` / `disable`, with `piiMasking.upstreams.<name>` per upstream or LLM provider; detection stays complete (taint, `piiHits`), only masking narrows. db-gateway gets `piiScan`: value-based masking of PII inside text columns no field rule covers, off by default, also set with `GATEWAY_PII_SCAN`.

### Patch Changes

- Updated dependencies [[`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1)]:
  - @guardbee/guard-core@0.17.0

## 0.3.6

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-telemetry@0.1.4

## 0.3.4

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3

## 0.3.3

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.2

## 0.3.2

### Patch Changes

- Rename the Turkish README from `README.tr.md` to `TR.md`. npm's registry picked `README.tr.md` (not `README.md`) as the displayed readme when both existed at the package root — any filename matching `/^readme/i` is apparently a candidate, not just an exact `README.md` match. Renaming the Turkish file so only `README.md` matches that pattern removes the ambiguity.

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
