# @guardbee/mcp-owasp-scan

## 0.2.7

### Patch Changes

- Updated dependencies [[`29b478f`](https://github.com/GuardBee/guardbee-mcp/commit/29b478f7106d6001cf113e8c2ed112a9d83ad7c9)]:
  - @guardbee/mcp-config-auditor@0.5.0
  - @guardbee/mcp-secret-scanner@0.6.4
  - @guardbee/mcp-tool-poisoning-scanner@0.2.11
  - @guardbee/mcp-toxic-flow-auditor@0.1.19

## 0.2.6

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-audit-gap-auditor@0.2.3
  - @guardbee/mcp-config-auditor@0.4.1
  - @guardbee/mcp-context-oversharing-auditor@0.2.2
  - @guardbee/mcp-oauth-auditor@0.1.6
  - @guardbee/mcp-secret-scanner@0.6.1
  - @guardbee/mcp-server-auditor@0.1.9
  - @guardbee/mcp-telemetry@0.1.4
  - @guardbee/mcp-tool-poisoning-scanner@0.2.8
  - @guardbee/mcp-toxic-flow-auditor@0.1.16

## 0.2.5

### Patch Changes

- Updated dependencies [[`4545f53`](https://github.com/GuardBee/guardbee-mcp/commit/4545f53505315149567c063da58526d7b1fc1633)]:
  - @guardbee/mcp-secret-scanner@0.6.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7)]:
  - @guardbee/mcp-secret-scanner@0.5.0
  - @guardbee/mcp-tool-poisoning-scanner@0.2.7
  - @guardbee/mcp-toxic-flow-auditor@0.1.15

## 0.2.3

### Patch Changes

- Updated dependencies [[`1cb3991`](https://github.com/GuardBee/guardbee-mcp/commit/1cb39919ca7a9a944c40d8865f3987b43d908435), [`841d816`](https://github.com/GuardBee/guardbee-mcp/commit/841d81617c76fdfe9849336e5daeee2fe09a1c9d)]:
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
