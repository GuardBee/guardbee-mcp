# @guardbee/mcp-audit-gap-auditor

## 0.2.2

### Patch Changes

- [#42](https://github.com/GuardBee/guardbee-mcp/pull/42) [`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.

## 0.2.1

### Patch Changes

- [#38](https://github.com/GuardBee/guardbee-mcp/pull/38) [`7a87a12`](https://github.com/GuardBee/guardbee-mcp/commit/7a87a1240e6a069d1efdb7fb598598dda5baa271) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `audit_disabled_in_code` no longer fires on documentation files (`.md`, `.mdx`, `.rst`, `.txt`, `.adoc`), where `GUARDBEE_TELEMETRY=0` is an opt-out instruction rather than a hard-coded disable.

## 0.2.0

### Minor Changes

- [#33](https://github.com/GuardBee/guardbee-mcp/pull/33) [`5c5277f`](https://github.com/GuardBee/guardbee-mcp/commit/5c5277f715ffe0d3df0cd07c0ba1350419290465) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add `@guardbee/mcp-audit-gap-auditor` for OWASP MCP08:2025 (Lack of Audit and Telemetry) — static checks for missing tool-call trails, raw args/results in logs, hard-disabled audit, silent catches, and audit events without correlation ids.
