# @guardbee/mcp-dependency-auditor

## 0.3.0

### Minor Changes

- [#82](https://github.com/GuardBee/guardbee-mcp/pull/82) [`7f87277`](https://github.com/GuardBee/guardbee-mcp/commit/7f872776b62f37f39b60bc35aa0022a61b97b66f) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: read exact versions from pnpm, yarn, bun, uv, Poetry and Pipenv lockfiles
  
  The auditor now reads `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (v1 and Berry), `bun.lock` and `npm-shrinkwrap.json` alongside `package-lock.json`, and `uv.lock`, `poetry.lock` and `Pipfile.lock` for Python. Projects using these package managers were previously audited only on the direct dependencies in `package.json` or `requirements.txt`, with versions guessed from ranges. They are now audited on every locked package, including transitive ones.
  
  When the lockfile does not mark dev packages (pnpm v9, yarn, bun, uv), they are told apart by walking the dependency graph from the project's production and dev roots. `--include-dev` / `includeDevDeps` now also applies to Python dev groups. Workspace members in `package-lock.json` are no longer sent to OSV as registry packages. In text mode the CLI prints which file each ecosystem was read from.

- [#82](https://github.com/GuardBee/guardbee-mcp/pull/82) [`fb28be0`](https://github.com/GuardBee/guardbee-mcp/commit/fb28be0bf134ba6334d82a4cdef31484ed93a080) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - feat: flag known-malicious package versions; merge duplicate advisories; stop truncating piped JSON/SARIF output
  
  - **Malware:** OpenSSF `MAL-*` records carry no severity score, so they were reported as UNKNOWN and passed `--fail-on`. The hijacked `chalk@5.6.1` from September 2025 exited 0. Releases with a `MAL-*` ID or alias, or an advisory classified CWE-506, are now critical. They are listed first with a removal and credential-rotation action, tagged `malicious` in SARIF, and marked `guardbee.malicious` in JSON.
  - **Duplicates:** OSV often returns one issue under several IDs that alias each other (GHSA + PYSEC for PyPI, GHSA + MAL for malware). They are now merged into one finding. `requests@2.19.0` reports 5 vulnerabilities instead of 10. The merged record keeps every ID, so `ignore` entries still match any of them.
  - **Truncated output:** The CLI called `process.exit()` right after writing the report, which cut piped output at 64 KB and left `--format=json | jq` with invalid JSON on larger projects. It now sets `process.exitCode` and lets stdout drain.
  - **JSON annotations:** Each finding in JSON output now carries `guardbee: { severity, malicious, fixedVersion }`, the verdict the CLI acted on.

## 0.2.6

### Patch Changes

- [#79](https://github.com/GuardBee/guardbee-mcp/pull/79) [`8a02c59`](https://github.com/GuardBee/guardbee-mcp/commit/8a02c59258eb7a92b40036b7692aa506c17a39d0) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - fix: fetch full OSV advisories so findings have real severity, summary, CVE aliases and fix versions
  
  OSV's `querybatch` endpoint returns only `{ id, modified }` for each vulnerability. Every finding was therefore reported as UNKNOWN with no summary or fix, `--fail-on` never failed a build, and `ignore` entries given as CVE IDs never matched. The auditor now fetches each advisory from `/v1/vulns/{id}`. Fetches are de-duplicated, run in parallel, cached and retried on 429/5xx. The auditor also follows `next_page_token`, and it fails with an error instead of passing when an advisory cannot be fetched.

## 0.2.5

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-telemetry@0.1.4

## 0.2.3

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3

## 0.2.2

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.2

## 0.2.1

### Patch Changes

- Make English the primary `README.md` (what npm and GitHub display by default) for every package, matching the change already made for `db-gateway`. The previous Turkish content moves to `TR.md`, linked via a language switcher at the top of both files. Docs-only change, no code/behavior changes.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.1

## 0.2.0

### Minor Changes

- [`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add usage telemetry via the new `@guardbee/mcp-telemetry` shared package — **on by default**, disable with `GUARDBEE_TELEMETRY=0`. Every tool call reports the tool name, a shape-preserving-redacted version of its parameters, success/failure, and duration to `app.guardbee.ai`.
  
  Redaction (`redactParams`, see `@guardbee/mcp-telemetry`'s README) replaces any string longer than 40 characters, and the value of any `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` key regardless of length, with a `"[redacted: ...]"` placeholder — full file/scan content and real row data are never sent, only short structural parameters like table names or limits. A one-time notice is printed to stderr on first use explaining this and how to opt out. This is a behavior change (these packages now make an outbound network call by default) — previously most of them advertised running entirely offline.

### Patch Changes

- [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add Smithery.ai integration files (`smithery.yaml`, `manifest.json`, `.well-known/mcp/server-card.json`), matching the pattern already used by `@guardbee/mcp-db-gateway`, so these servers are one-click installable from Smithery and discoverable via their MCP server card. No functional/runtime code changes — these files are read from the GitHub repo by Smithery, not from the published npm tarball (`package.json` `files` is unchanged).
