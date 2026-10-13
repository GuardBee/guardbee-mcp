# @guardbee/mcp-dns-intelligence

## 0.3.0

### Minor Changes

- [#91](https://github.com/GuardBee/guardbee-mcp/pull/91) [`8d264b7`](https://github.com/GuardBee/guardbee-mcp/commit/8d264b745d8d49560dc228aed707eada05a4b703) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - fix: count SPF lookups the way receivers do, filter wildcard DNS, parse DMARC robustly
  
  **SPF**
  - The lookup count read `-all`/`~all` as the `a` mechanism, so every record was over-counted by one.
  - It also ignored nested includes. GitHub's record was reported as 9; receivers count 10.
  - SPF is now evaluated through every `include`/`redirect`, following RFC 7208:
    - more than 10 lookups is `SPF_TOO_MANY_LOOKUPS`; exactly 10 is `SPF_AT_LOOKUP_LIMIT`
    - more than 2 void lookups is `SPF_TOO_MANY_VOID_LOOKUPS`
    - `SPF_INCLUDE_LOOP`, `SPF_INCLUDE_MISSING`, `SPF_INCLUDE_DUPLICATE`, `SPF_PTR`
  - `v=spf1` is matched case-insensitively and no longer matches `v=spf10`.
  
  **DMARC**
  - Tags are case-insensitive, and values may contain `=`.
  - An unknown `p=` is `DMARC_INVALID_POLICY`.
  - `pct<100` is flagged for `reject` too, and `sp=none` is `DMARC_SUBDOMAINS_NONE`.
  - Several records are `DMARC_MULTIPLE`; receivers ignore them all.
  - Subdomains inherit the parent domain's record with its `sp=` policy.
  
  **Wildcard DNS**
  - `enumerate_subdomains` / `subdomains` probe two random labels first.
  - Names answered only by `*.domain` are left out and counted. On `github.io` the wordlist reported 78 fake "live" subdomains.
  
  **Other fixes**
  - A domain that does not exist reports `DOMAIN_NOT_FOUND` instead of missing SPF/DMARC.
  - Subdomains without an SOA are no longer flagged `NS_MISSING`.
  - `zoneTransferVulnerable` is no longer reported as `false`; it was never checked.
  - Domains given as URLs or with capitals or trailing dots are normalized; invalid input is an error.
  - The CLI no longer truncates piped JSON. An explicit `--fail-on` overrides `guardbee.yml`, and invalid `--fail-on` / `--concurrency` values are errors.
  - `enumerateDomain` / `enumerateSubdomains` accept an injectable resolver. `enumerateSubdomainsDetailed`, `evaluateSpf` and `normalizeDomain` are exported.

## 0.2.4

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-telemetry@0.1.4

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
