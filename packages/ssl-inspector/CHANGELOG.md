# @guardbee/mcp-ssl-inspector

## 0.3.0

### Minor Changes

- [#72](https://github.com/GuardBee/guardbee-mcp/pull/72) [`5ff4334`](https://github.com/GuardBee/guardbee-mcp/commit/5ff4334d6037cfd1088bdda5807094400d09a25a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Probes for what a server still accepts, not just what a modern client negotiates: TLS 1.0/1.1, TLS 1.3 support, RSA key exchange (no forward secrecy), Diffie-Hellman group size and weak cipher families (families this runtime's OpenSSL lacks are reported as not tested). Certificate checks gain key size, SHA-1/MD5 signatures in the chain, hostname mismatch, and chain errors told apart (self-signed, incomplete chain, revoked); plus OCSP stapling and CAA. A TLS-1.0-only server is now inspected instead of reported unreachable. Fixes ChaCha20 suites being flagged as 20-bit ciphers, and the expiry warning that fired on every 90-day (Let's Encrypt) certificate.

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
