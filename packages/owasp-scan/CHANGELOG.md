# @guardbee/mcp-owasp-scan

## 0.2.3

### Patch Changes

- Updated dependencies [[`841d816`](https://github.com/GuardBee/guardbee-mcp/commit/841d81617c76fdfe9849336e5daeee2fe09a1c9d)]:
  - @guardbee/mcp-secret-scanner@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`149e46f`](https://github.com/GuardBee/guardbee-mcp/commit/149e46fd7c47c5c6dbb194850d49be35c2301c11)]:
  - @guardbee/mcp-secret-scanner@0.3.0
  - @guardbee/mcp-tool-poisoning-scanner@0.2.6
  - @guardbee/mcp-toxic-flow-auditor@0.1.14

## 0.2.1

### Patch Changes

- [#42](https://github.com/GuardBee/guardbee-mcp/pull/42) [`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.
- Updated dependencies [[`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00)]:
  - @guardbee/mcp-audit-gap-auditor@0.2.2
  - @guardbee/mcp-context-oversharing-auditor@0.2.1
  - @guardbee/mcp-server-auditor@0.1.8
  - @guardbee/mcp-oauth-auditor@0.1.5
  - @guardbee/mcp-secret-scanner@0.2.13
  - @guardbee/mcp-toxic-flow-auditor@0.1.8

## 0.2.0

### Minor Changes

- [#38](https://github.com/GuardBee/guardbee-mcp/pull/38) [`e8b97bb`](https://github.com/GuardBee/guardbee-mcp/commit/e8b97bb6f3cb434b07f5660cfb9d73258581db8c) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Ship AI-security MCP gap follow-up: unified OWASP MCP Top 10 meta-scanner (`mcp-owasp-scan`), MCP10 context-oversharing auditor, Python MCP05/OAuth patterns, and a reusable GitHub Action that uploads SARIF for toxic-flow / audit-gap / context-oversharing / owasp-scan.

### Patch Changes

- Updated dependencies [[`e8b97bb`](https://github.com/GuardBee/guardbee-mcp/commit/e8b97bb6f3cb434b07f5660cfb9d73258581db8c), [`7a87a12`](https://github.com/GuardBee/guardbee-mcp/commit/7a87a1240e6a069d1efdb7fb598598dda5baa271), [`67f10b5`](https://github.com/GuardBee/guardbee-mcp/commit/67f10b56b9ac924b95872e1925549caa04d81246)]:
  - @guardbee/mcp-context-oversharing-auditor@0.2.0
  - @guardbee/mcp-server-auditor@0.1.7
  - @guardbee/mcp-oauth-auditor@0.1.4
  - @guardbee/mcp-audit-gap-auditor@0.2.1
  - @guardbee/mcp-toxic-flow-auditor@0.1.6

## 0.1.0

### Minor Changes

- Add `@guardbee/mcp-owasp-scan` — unified OWASP MCP Top 10 meta-scanner. Path mode orchestrates secret, server, oauth, audit-gap, context-oversharing, toxic-flow, and tool-poisoning auditors; live/catalog modes call `tools/list` (or accept a dump) for MCP03/MCP10 with A–F grading and SARIF.
