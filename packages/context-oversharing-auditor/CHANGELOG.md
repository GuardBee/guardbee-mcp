# @guardbee/mcp-context-oversharing-auditor

## 0.2.1

### Patch Changes

- [#42](https://github.com/GuardBee/guardbee-mcp/pull/42) [`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.

## 0.2.0

### Minor Changes

- [#38](https://github.com/GuardBee/guardbee-mcp/pull/38) [`e8b97bb`](https://github.com/GuardBee/guardbee-mcp/commit/e8b97bb6f3cb434b07f5660cfb9d73258581db8c) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Ship AI-security MCP gap follow-up: unified OWASP MCP Top 10 meta-scanner (`mcp-owasp-scan`), MCP10 context-oversharing auditor, Python MCP05/OAuth patterns, and a reusable GitHub Action that uploads SARIF for toxic-flow / audit-gap / context-oversharing / owasp-scan.

## 0.1.0

### Minor Changes

- Add `@guardbee/mcp-context-oversharing-auditor` for OWASP MCP10:2025 context oversharing — session dumps, unscoped memory tools, shared global context, system-prompt leaks via tools, cross-session tool-result bleed, and unfiltered vector queries. Complements toxic-flow (catalog trifecta) with source-level oversharing checks.
