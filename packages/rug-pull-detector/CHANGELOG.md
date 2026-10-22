# @guardbee/mcp-rug-pull-detector

## 0.3.0

### Minor Changes

- [#172](https://github.com/GuardBee/guardbee-mcp/pull/172) [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `security-suite` now covers every GuardBee scanner and auditor (29 packages, 124 MCP tools). `guardbee serve` serves the recommended group by default (owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor: 31 tools); `--tools=` (or `GUARDBEE_SUITE_TOOLS`) takes groups (`code`, `supply-chain`, `network`, `platform`, `all`) and package ids. Tool names carry their package's prefix (`secrets_scan_text`, `injection_scan_text`) so packages do not collide. `guardbee <package-id> <args>` runs any package's CLI and `guardbee list` lists them; the old `secret-scan`, `dep-audit`, `ssl-inspect` and `dns-check` shortcuts still work. With no arguments and no terminal on stdin (an MCP client starting it), the suite now serves instead of printing help, and its MCP Registry entry passes `serve`.
  
  **Breaking for `guardbee serve` users:** the five plain tool names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`) are now prefixed package tools; see "Upgrading from 0.2" in the README.
  
  Every scanner and auditor package exports `registerTools(server)`, which registers its MCP tools on a given `McpServer`; `startServer()` uses it.

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395), [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947)]:
  - @guardbee/mcp-tool-poisoning-scanner@0.3.0
  - @guardbee/mcp-telemetry@0.2.0

## 0.2.2

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-telemetry@0.1.4
  - @guardbee/mcp-tool-poisoning-scanner@0.2.8

## 0.2.0

### Minor Changes

- [#6](https://github.com/GuardBee/guardbee-mcp/pull/6) [`7f0e01f`](https://github.com/GuardBee/guardbee-mcp/commit/7f0e01f9b15e033928c395ccffbb0118842a604c) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add an MCP client-config auditor, live tool-catalog poisoning checks, cross-server tool shadowing, and proxy guards for tool-result injection and mid-session definition drift. Findings that these checks emit carry OWASP MCP Top 10 tags.

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`7f0e01f`](https://github.com/GuardBee/guardbee-mcp/commit/7f0e01f9b15e033928c395ccffbb0118842a604c), [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-tool-poisoning-scanner@0.2.0
  - @guardbee/mcp-telemetry@0.1.3
