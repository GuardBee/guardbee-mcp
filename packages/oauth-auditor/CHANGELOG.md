# @guardbee/mcp-oauth-auditor

## 0.1.5

### Patch Changes

- [#42](https://github.com/GuardBee/guardbee-mcp/pull/42) [`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.

## 0.1.4

### Patch Changes

- [#38](https://github.com/GuardBee/guardbee-mcp/pull/38) [`e8b97bb`](https://github.com/GuardBee/guardbee-mcp/commit/e8b97bb6f3cb434b07f5660cfb9d73258581db8c) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Ship AI-security MCP gap follow-up: unified OWASP MCP Top 10 meta-scanner (`mcp-owasp-scan`), MCP10 context-oversharing auditor, Python MCP05/OAuth patterns, and a reusable GitHub Action that uploads SARIF for toxic-flow / audit-gap / context-oversharing / owasp-scan.

## 0.1.1

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3
