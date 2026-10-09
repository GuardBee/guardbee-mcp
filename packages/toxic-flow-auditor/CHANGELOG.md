## 0.1.6

### Patch Changes

- [#38](https://github.com/GuardBee/guardbee-mcp/pull/38) [`67f10b5`](https://github.com/GuardBee/guardbee-mcp/commit/67f10b56b9ac924b95872e1925549caa04d81246) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - SARIF output is now accepted by GitHub code scanning: rules no longer repeat the `toxic-flow` tag, and findings (which span several tools and have no file of their own) are anchored to the scanned path.
## 0.1.5

### Patch Changes

- Updated dependencies [[`75f4bad`](https://github.com/GuardBee/guardbee-mcp/commit/75f4baddd164e252be4f8004e2ec8e0054cbd218)]:
  - @guardbee/guard-core@0.4.0
## 0.1.4

### Patch Changes

- Updated dependencies [[`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35)]:
  - @guardbee/guard-core@0.3.0
## 0.1.3

### Patch Changes

- Docs: add a Simplified Chinese README (`ZH.md`) and link it from the English and Turkish ones. Correct stale counts (secret-scanner: 38 patterns and 39 tests; prompt-injection-scanner: 45 tests) and add a Turkish README for guard-core. No code changes.
- Updated dependencies [`243991e`]:
  - @guardbee/guard-core@0.2.1
## 0.1.2

### Patch Changes

- Updated dependencies [`15fb399`]:
  - @guardbee/guard-core@0.2.0
## 0.1.1

### Patch Changes

- Move shared detectors into the new `@guardbee/guard-core` library.
  
  security-proxy now validates PII matches before masking them: a TC Kimlik No must pass the official checksum, an IBAN must pass mod-97, and a card number must pass Luhn. Order numbers and other 11- or 16-digit values are no longer masked by mistake.
  
  toxic-flow-auditor and prompt-leak-scanner now import tool classification and checksum validators from guard-core. prompt-leak-scanner behaves as before; for toxic-flow-auditor see the snake_case classification fix.

- security-proxy 1.0: gateway mode.
  
  - `guardbee-proxy.yaml` puts several MCP servers behind one proxy. Tools and prompts are exposed as `<upstream>__<tool>`; one failing server no longer hides the others' tools.
  - Policy rules (`allow` / `deny` / `mask` / `warn`) match on tool glob, upstream, label and session taint; the first match wins.
  - Toxic-flow (lethal trifecta) tracking across servers: once a session has read untrusted content and sensitive data, an egress call is blocked (`taint.mode: strict`, the YAML default) or logged (`warn`).
  - `resources/read` is now scanned for injection, PII-masked, and counted as untrusted content.
  - The audit log is hash-chained (`guardbee-proxy verify-audit <file>`). With the YAML config it stores a SHA-256 of the arguments instead of the arguments, and no results, unless `audit.includePayloads: true`.
  - New `guardbee-proxy validate` command.
  
  The single-server `guardbee-proxy -- <command>` form and `guardbee-proxy.json` keep their 0.x behavior: unprefixed tool names, payloads logged, toxic flows only warned.
  
  toxic-flow-auditor: tool names in snake_case are now classified word by word (`read_vault_secret` is sensitive, `drop_table` destructive), and pull requests count as exfiltration. Catalogs may report more findings than before.
## 0.1.0

### Minor Changes

- Initial release: lethal trifecta / toxic-flow auditor for MCP tool catalogs (OWASP MCP10:2025). Grades A–F, CLI + MCP tools, KVKK-aware sensitive-data heuristics.
