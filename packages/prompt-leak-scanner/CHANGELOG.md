# @guardbee/mcp-prompt-leak-scanner

## 1.0.2

### Patch Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.

## 1.0.1

### Patch Changes

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-telemetry@0.3.0
  - @guardbee/guard-core@1.0.1

## 1.0.0

### Major Changes

- [#171](https://github.com/GuardBee/guardbee-mcp/pull/171) [`c3b71f8`](https://github.com/GuardBee/guardbee-mcp/commit/c3b71f8e1305cbabe0fa733b13f6eb9a95d08513) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - 1.0: no API change, a stability promise. From this release the package follows semantic versioning: a breaking change to its CLI, MCP tool names and parameters, config format or exported API comes only with a new major version and is listed here. New rules and detectors arrive in minor versions and can report findings an earlier version did not.

### Minor Changes

- [#172](https://github.com/GuardBee/guardbee-mcp/pull/172) [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `security-suite` now covers every GuardBee scanner and auditor (29 packages, 124 MCP tools). `guardbee serve` serves the recommended group by default (owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor: 31 tools); `--tools=` (or `GUARDBEE_SUITE_TOOLS`) takes groups (`code`, `supply-chain`, `network`, `platform`, `all`) and package ids. Tool names carry their package's prefix (`secrets_scan_text`, `injection_scan_text`) so packages do not collide. `guardbee <package-id> <args>` runs any package's CLI and `guardbee list` lists them; the old `secret-scan`, `dep-audit`, `ssl-inspect` and `dns-check` shortcuts still work. With no arguments and no terminal on stdin (an MCP client starting it), the suite now serves instead of printing help, and its MCP Registry entry passes `serve`.
  
  **Breaking for `guardbee serve` users:** the five plain tool names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`) are now prefixed package tools; see "Upgrading from 0.2" in the README.
  
  Every scanner and auditor package exports `registerTools(server)`, which registers its MCP tools on a given `McpServer`; `startServer()` uses it.

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395), [`c3b71f8`](https://github.com/GuardBee/guardbee-mcp/commit/c3b71f8e1305cbabe0fa733b13f6eb9a95d08513)]:
  - @guardbee/guard-core@1.0.0
  - @guardbee/mcp-telemetry@0.2.0

## 0.1.27

### Patch Changes

- Updated dependencies [[`9599fb6`](https://github.com/GuardBee/guardbee-mcp/commit/9599fb64249dc38baba3fd4b2d1d7fb82dfd6de3)]:
  - @guardbee/guard-core@0.22.0

## 0.1.26

### Patch Changes

- Updated dependencies [[`c1a16b9`](https://github.com/GuardBee/guardbee-mcp/commit/c1a16b9c9f588c4d3735fb45a1339b33119a8de0)]:
  - @guardbee/guard-core@0.21.0

## 0.1.25

### Patch Changes

- Updated dependencies [[`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16)]:
  - @guardbee/guard-core@0.20.0

## 0.1.24

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0

## 0.1.23

### Patch Changes

- Updated dependencies [[`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548)]:
  - @guardbee/guard-core@0.18.0

## 0.1.22

### Patch Changes

- Updated dependencies [[`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1)]:
  - @guardbee/guard-core@0.17.0

## 0.1.21

### Patch Changes

- Updated dependencies [[`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69)]:
  - @guardbee/guard-core@0.16.0

## 0.1.20

### Patch Changes

- Updated dependencies [[`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1), [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232)]:
  - @guardbee/guard-core@0.15.0

## 0.1.19

### Patch Changes

- Updated dependencies [[`08cc29e`](https://github.com/GuardBee/guardbee-mcp/commit/08cc29e4ca69af9aaf2bcbbde9f31824c9ada5c7)]:
  - @guardbee/guard-core@0.14.0

## 0.1.18

### Patch Changes

- Updated dependencies [[`13c4c8f`](https://github.com/GuardBee/guardbee-mcp/commit/13c4c8f7afb29c7c373f83b1f64ae518edc08a46)]:
  - @guardbee/guard-core@0.13.0

## 0.1.17

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/guard-core@0.12.1
  - @guardbee/mcp-telemetry@0.1.4

## 0.1.16

### Patch Changes

- Updated dependencies [[`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7)]:
  - @guardbee/guard-core@0.12.0

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
