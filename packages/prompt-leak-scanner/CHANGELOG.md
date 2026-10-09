# @guardbee/mcp-prompt-leak-scanner

## 0.1.15

### Patch Changes

- Updated dependencies [[`64aeffa`](https://github.com/GuardBee/guardbee-mcp/commit/64aeffa43ce641738a9858818aa59d88154bf25a)]:
  - @guardbee/guard-core@0.11.0

## 0.1.14

### Patch Changes

- Updated dependencies [[`20bbdc4`](https://github.com/GuardBee/guardbee-mcp/commit/20bbdc49affdebbbfce869d85176ab3b38aa23ce)]:
  - @guardbee/guard-core@0.10.0

## 0.1.13

### Patch Changes

- Updated dependencies [[`659b893`](https://github.com/GuardBee/guardbee-mcp/commit/659b893a82c92f6c579ea50de50b942448c23bea)]:
  - @guardbee/guard-core@0.9.0

## 0.1.12

### Patch Changes

- Updated dependencies [[`34ead6f`](https://github.com/GuardBee/guardbee-mcp/commit/34ead6fb45d6b093c441b28c83d73107ff20d0a3)]:
  - @guardbee/guard-core@0.8.0

## 0.1.11

### Patch Changes

- Updated dependencies [[`aa299d3`](https://github.com/GuardBee/guardbee-mcp/commit/aa299d3d3343bfbf48bc36b78036d7d7cb1565ed)]:
  - @guardbee/guard-core@0.7.0

## 0.1.10

### Patch Changes

- Updated dependencies [[`b8dee60`](https://github.com/GuardBee/guardbee-mcp/commit/b8dee60a6092f16ba1442cafafa60fa842cffd42)]:
  - @guardbee/guard-core@0.6.0

## 0.1.9

### Patch Changes

- [#42](https://github.com/GuardBee/guardbee-mcp/pull/42) [`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.

## 0.1.8

### Patch Changes

- Updated dependencies [[`b1de97f`](https://github.com/GuardBee/guardbee-mcp/commit/b1de97f5cbeaf1951798970a56917b8378b45848)]:
  - @guardbee/guard-core@0.5.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`75f4bad`](https://github.com/GuardBee/guardbee-mcp/commit/75f4baddd164e252be4f8004e2ec8e0054cbd218)]:
  - @guardbee/guard-core@0.4.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35)]:
  - @guardbee/guard-core@0.3.0

## 0.1.5

### Patch Changes

- Docs: add a Simplified Chinese README (`ZH.md`) and link it from the English and Turkish ones. Correct stale counts (secret-scanner: 38 patterns and 39 tests; prompt-injection-scanner: 45 tests) and add a Turkish README for guard-core. No code changes.
- Updated dependencies [`243991e`]:
  - @guardbee/guard-core@0.2.1

## 0.1.4

### Patch Changes

- Updated dependencies [`15fb399`]:
  - @guardbee/guard-core@0.2.0

## 0.1.3

### Patch Changes

- Move shared detectors into the new `@guardbee/guard-core` library.
  
  security-proxy now validates PII matches before masking them: a TC Kimlik No must pass the official checksum, an IBAN must pass mod-97, and a card number must pass Luhn. Order numbers and other 11- or 16-digit values are no longer masked by mistake.
  
  toxic-flow-auditor and prompt-leak-scanner now import tool classification and checksum validators from guard-core. prompt-leak-scanner behaves as before; for toxic-flow-auditor see the snake_case classification fix.

## 0.1.1

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3
