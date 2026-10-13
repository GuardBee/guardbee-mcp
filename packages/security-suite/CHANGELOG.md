# @guardbee/security-suite

## 0.2.10

### Patch Changes

- Updated dependencies [[`7f87277`](https://github.com/GuardBee/guardbee-mcp/commit/7f872776b62f37f39b60bc35aa0022a61b97b66f), [`fb28be0`](https://github.com/GuardBee/guardbee-mcp/commit/fb28be0bf134ba6334d82a4cdef31484ed93a080)]:
  - @guardbee/mcp-dependency-auditor@0.3.0

## 0.2.9

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-dependency-auditor@0.2.5
  - @guardbee/mcp-dns-intelligence@0.2.4
  - @guardbee/mcp-secret-scanner@0.6.1
  - @guardbee/mcp-ssl-inspector@0.3.1
  - @guardbee/mcp-telemetry@0.1.4

## 0.2.8

### Patch Changes

- Updated dependencies [[`5ff4334`](https://github.com/GuardBee/guardbee-mcp/commit/5ff4334d6037cfd1088bdda5807094400d09a25a)]:
  - @guardbee/mcp-ssl-inspector@0.3.0

## 0.2.7

### Patch Changes

- Updated dependencies [[`4545f53`](https://github.com/GuardBee/guardbee-mcp/commit/4545f53505315149567c063da58526d7b1fc1633)]:
  - @guardbee/mcp-secret-scanner@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7)]:
  - @guardbee/mcp-secret-scanner@0.5.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`1cb3991`](https://github.com/GuardBee/guardbee-mcp/commit/1cb39919ca7a9a944c40d8865f3987b43d908435), [`841d816`](https://github.com/GuardBee/guardbee-mcp/commit/841d81617c76fdfe9849336e5daeee2fe09a1c9d)]:
  - @guardbee/mcp-secret-scanner@0.4.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`149e46f`](https://github.com/GuardBee/guardbee-mcp/commit/149e46fd7c47c5c6dbb194850d49be35c2301c11)]:
  - @guardbee/mcp-secret-scanner@0.3.0

## 0.2.2

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-dependency-auditor@0.2.2
  - @guardbee/mcp-dns-intelligence@0.2.2
  - @guardbee/mcp-secret-scanner@0.2.2
  - @guardbee/mcp-ssl-inspector@0.2.2
  - @guardbee/mcp-telemetry@0.1.2

## 0.2.1

### Patch Changes

- Make English the primary `README.md` (what npm and GitHub display by default) for every package, matching the change already made for `db-gateway`. The previous Turkish content moves to `TR.md`, linked via a language switcher at the top of both files. Docs-only change, no code/behavior changes.
- Updated dependencies []:
  - @guardbee/mcp-dependency-auditor@0.2.1
  - @guardbee/mcp-dns-intelligence@0.2.1
  - @guardbee/mcp-secret-scanner@0.2.1
  - @guardbee/mcp-ssl-inspector@0.2.1
  - @guardbee/mcp-telemetry@0.1.1

## 0.2.0

### Minor Changes

- [`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add usage telemetry via the new `@guardbee/mcp-telemetry` shared package — **on by default**, disable with `GUARDBEE_TELEMETRY=0`. Every tool call reports the tool name, a shape-preserving-redacted version of its parameters, success/failure, and duration to `app.guardbee.ai`.
  
  Redaction (`redactParams`, see `@guardbee/mcp-telemetry`'s README) replaces any string longer than 40 characters, and the value of any `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` key regardless of length, with a `"[redacted: ...]"` placeholder — full file/scan content and real row data are never sent, only short structural parameters like table names or limits. A one-time notice is printed to stderr on first use explaining this and how to opt out. This is a behavior change (these packages now make an outbound network call by default) — previously most of them advertised running entirely offline.

### Patch Changes

- [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add Smithery.ai integration files (`smithery.yaml`, `manifest.json`, `.well-known/mcp/server-card.json`), matching the pattern already used by `@guardbee/mcp-db-gateway`, so these servers are one-click installable from Smithery and discoverable via their MCP server card. No functional/runtime code changes — these files are read from the GitHub repo by Smithery, not from the published npm tarball (`package.json` `files` is unchanged).
- Updated dependencies [[`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967), [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b)]:
  - @guardbee/mcp-dependency-auditor@0.2.0
  - @guardbee/mcp-dns-intelligence@0.2.0
  - @guardbee/mcp-secret-scanner@0.2.0
  - @guardbee/mcp-ssl-inspector@0.2.0
