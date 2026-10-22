# @guardbee/security-suite

## 0.4.1

### Patch Changes

- Updated dependencies [[`103a94b`](https://github.com/GuardBee/guardbee-mcp/commit/103a94bd39d17e616e75878e03d406575dec82e9)]:
  - @guardbee/mcp-oauth-auditor@0.3.0
  - @guardbee/mcp-owasp-scan@0.3.3

## 0.4.0

### Minor Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.

### Patch Changes

- Updated dependencies [[`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3)]:
  - @guardbee/mcp-a2a-auditor@0.2.2
  - @guardbee/mcp-agent-graph-auditor@0.2.2
  - @guardbee/mcp-ai-code-scanner@0.4.2
  - @guardbee/mcp-audit-gap-auditor@0.3.2
  - @guardbee/mcp-compliance-checker@0.3.2
  - @guardbee/mcp-context-oversharing-auditor@0.3.2
  - @guardbee/mcp-dependency-auditor@0.7.2
  - @guardbee/mcp-dns-intelligence@0.9.2
  - @guardbee/mcp-document-scanner@0.3.0
  - @guardbee/mcp-elicitation-auditor@0.2.2
  - @guardbee/mcp-llm-redteam@0.2.2
  - @guardbee/mcp-config-auditor@0.6.2
  - @guardbee/mcp-server-auditor@0.2.2
  - @guardbee/mcp-memory-poisoning-scanner@0.2.2
  - @guardbee/mcp-model-scanner@0.2.2
  - @guardbee/mcp-oauth-auditor@0.2.2
  - @guardbee/mcp-owasp-scan@0.3.2
  - @guardbee/mcp-prompt-injection-scanner@1.0.2
  - @guardbee/mcp-prompt-leak-scanner@1.0.2
  - @guardbee/mcp-rug-pull-detector@0.3.2
  - @guardbee/mcp-secret-scanner@1.0.2
  - @guardbee/mcp-slopsquat-scanner@0.2.2
  - @guardbee/mcp-ssl-inspector@0.4.2
  - @guardbee/mcp-threat-rules@0.4.2
  - @guardbee/mcp-tool-poisoning-scanner@0.3.2
  - @guardbee/mcp-toxic-flow-auditor@1.0.2
  - @guardbee/mcp-unbounded-consumption-auditor@0.2.2
  - @guardbee/mcp-vector-store-scanner@0.2.2
  - @guardbee/mcp-vulnerability-scanner@0.3.2

## 0.3.1

### Patch Changes

- [#185](https://github.com/GuardBee/guardbee-mcp/pull/185) [`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `mcp-security-proxy` and `mcp-db-gateway` get an `exports` map (the package root, `./dist/*` for existing deep imports, `package.json`); db-gateway also exports `./adapters/*`, so the documented `import { createPrismaAdapter } from "@guardbee/mcp-db-gateway/adapters/prisma"` now resolves. The proxy moves to ldapts 9 (its older uuid had an advisory). The telemetry package description now says opt-in, the suite's starts with "MCP security suite", and document-scanner's homepage is its README.

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`ee8718b`](https://github.com/GuardBee/guardbee-mcp/commit/ee8718b0ab9a169473a365818089f84c6b1080b7), [`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-toxic-flow-auditor@1.0.1
  - @guardbee/mcp-tool-poisoning-scanner@0.3.1
  - @guardbee/mcp-server-auditor@0.2.1
  - @guardbee/mcp-audit-gap-auditor@0.3.1
  - @guardbee/mcp-unbounded-consumption-auditor@0.2.1
  - @guardbee/mcp-ai-code-scanner@0.4.1
  - @guardbee/mcp-telemetry@0.3.0
  - @guardbee/mcp-document-scanner@0.2.1
  - @guardbee/mcp-a2a-auditor@0.2.1
  - @guardbee/mcp-agent-graph-auditor@0.2.1
  - @guardbee/mcp-compliance-checker@0.3.1
  - @guardbee/mcp-context-oversharing-auditor@0.3.1
  - @guardbee/mcp-dependency-auditor@0.7.1
  - @guardbee/mcp-dns-intelligence@0.9.1
  - @guardbee/mcp-elicitation-auditor@0.2.1
  - @guardbee/mcp-llm-redteam@0.2.1
  - @guardbee/mcp-config-auditor@0.6.1
  - @guardbee/mcp-memory-poisoning-scanner@0.2.1
  - @guardbee/mcp-model-scanner@0.2.1
  - @guardbee/mcp-oauth-auditor@0.2.1
  - @guardbee/mcp-owasp-scan@0.3.1
  - @guardbee/mcp-prompt-injection-scanner@1.0.1
  - @guardbee/mcp-prompt-leak-scanner@1.0.1
  - @guardbee/mcp-rug-pull-detector@0.3.1
  - @guardbee/mcp-secret-scanner@1.0.1
  - @guardbee/mcp-slopsquat-scanner@0.2.1
  - @guardbee/mcp-ssl-inspector@0.4.1
  - @guardbee/mcp-threat-rules@0.4.1
  - @guardbee/mcp-vector-store-scanner@0.2.1
  - @guardbee/mcp-vulnerability-scanner@0.3.1

## 0.3.0

### Minor Changes

- [#172](https://github.com/GuardBee/guardbee-mcp/pull/172) [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `security-suite` now covers every GuardBee scanner and auditor (29 packages, 124 MCP tools). `guardbee serve` serves the recommended group by default (owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor: 31 tools); `--tools=` (or `GUARDBEE_SUITE_TOOLS`) takes groups (`code`, `supply-chain`, `network`, `platform`, `all`) and package ids. Tool names carry their package's prefix (`secrets_scan_text`, `injection_scan_text`) so packages do not collide. `guardbee <package-id> <args>` runs any package's CLI and `guardbee list` lists them; the old `secret-scan`, `dep-audit`, `ssl-inspect` and `dns-check` shortcuts still work. With no arguments and no terminal on stdin (an MCP client starting it), the suite now serves instead of printing help, and its MCP Registry entry passes `serve`.
  
  **Breaking for `guardbee serve` users:** the five plain tool names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`) are now prefixed package tools; see "Upgrading from 0.2" in the README.
  
  Every scanner and auditor package exports `registerTools(server)`, which registers its MCP tools on a given `McpServer`; `startServer()` uses it.

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395), [`c3b71f8`](https://github.com/GuardBee/guardbee-mcp/commit/c3b71f8e1305cbabe0fa733b13f6eb9a95d08513), [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947)]:
  - @guardbee/mcp-a2a-auditor@0.2.0
  - @guardbee/mcp-agent-graph-auditor@0.2.0
  - @guardbee/mcp-ai-code-scanner@0.4.0
  - @guardbee/mcp-audit-gap-auditor@0.3.0
  - @guardbee/mcp-compliance-checker@0.3.0
  - @guardbee/mcp-context-oversharing-auditor@0.3.0
  - @guardbee/mcp-dependency-auditor@0.7.0
  - @guardbee/mcp-dns-intelligence@0.9.0
  - @guardbee/mcp-document-scanner@0.2.0
  - @guardbee/mcp-elicitation-auditor@0.2.0
  - @guardbee/mcp-llm-redteam@0.2.0
  - @guardbee/mcp-config-auditor@0.6.0
  - @guardbee/mcp-server-auditor@0.2.0
  - @guardbee/mcp-memory-poisoning-scanner@0.2.0
  - @guardbee/mcp-model-scanner@0.2.0
  - @guardbee/mcp-oauth-auditor@0.2.0
  - @guardbee/mcp-owasp-scan@0.3.0
  - @guardbee/mcp-prompt-injection-scanner@1.0.0
  - @guardbee/mcp-prompt-leak-scanner@1.0.0
  - @guardbee/mcp-rug-pull-detector@0.3.0
  - @guardbee/mcp-secret-scanner@1.0.0
  - @guardbee/mcp-slopsquat-scanner@0.2.0
  - @guardbee/mcp-ssl-inspector@0.4.0
  - @guardbee/mcp-threat-rules@0.4.0
  - @guardbee/mcp-tool-poisoning-scanner@0.3.0
  - @guardbee/mcp-toxic-flow-auditor@1.0.0
  - @guardbee/mcp-unbounded-consumption-auditor@0.2.0
  - @guardbee/mcp-vector-store-scanner@0.2.0
  - @guardbee/mcp-vulnerability-scanner@0.3.0
  - @guardbee/mcp-telemetry@0.2.0

## 0.2.19

### Patch Changes

- Updated dependencies [[`e8e4835`](https://github.com/GuardBee/guardbee-mcp/commit/e8e483501ff93f7fc6c945ebac76d0a14cbe7d59)]:
  - @guardbee/mcp-dns-intelligence@0.8.0

## 0.2.18

### Patch Changes

- Updated dependencies [[`d9e2085`](https://github.com/GuardBee/guardbee-mcp/commit/d9e2085d817a3367b7950ecd4c0a5e9f21f7746d)]:
  - @guardbee/mcp-dns-intelligence@0.7.0

## 0.2.17

### Patch Changes

- Updated dependencies [[`43fa7d2`](https://github.com/GuardBee/guardbee-mcp/commit/43fa7d25161b9279431636bd32465fe82baf3d33), [`237926d`](https://github.com/GuardBee/guardbee-mcp/commit/237926d457146f239cbc2d3243e0294ebc8f7176)]:
  - @guardbee/mcp-dns-intelligence@0.6.0

## 0.2.16

### Patch Changes

- Updated dependencies [[`fec0601`](https://github.com/GuardBee/guardbee-mcp/commit/fec0601472df7fd1dfcd20b503703d42e2474e49)]:
  - @guardbee/mcp-dns-intelligence@0.5.0

## 0.2.15

### Patch Changes

- Updated dependencies [[`5302420`](https://github.com/GuardBee/guardbee-mcp/commit/53024202a7a7ba6f39ee6cadbf9224c4ad6a21ee)]:
  - @guardbee/mcp-dns-intelligence@0.4.0

## 0.2.14

### Patch Changes

- Updated dependencies [[`8d264b7`](https://github.com/GuardBee/guardbee-mcp/commit/8d264b745d8d49560dc228aed707eada05a4b703)]:
  - @guardbee/mcp-dns-intelligence@0.3.0

## 0.2.13

### Patch Changes

- Updated dependencies [[`1ceb3ff`](https://github.com/GuardBee/guardbee-mcp/commit/1ceb3ff71f049c077445241b03c7a6985dea13c3)]:
  - @guardbee/mcp-dependency-auditor@0.6.0

## 0.2.12

### Patch Changes

- Updated dependencies [[`98f6c7d`](https://github.com/GuardBee/guardbee-mcp/commit/98f6c7d95faf1c23ea679a116ec2e78d4d6e4661), [`649ecae`](https://github.com/GuardBee/guardbee-mcp/commit/649ecaed08bdefd60c75732be44158c37e53ef22)]:
  - @guardbee/mcp-dependency-auditor@0.5.0

## 0.2.11

### Patch Changes

- Updated dependencies [[`0eb555a`](https://github.com/GuardBee/guardbee-mcp/commit/0eb555a3e4a9635fb7a33f7b0b3e2de668585e3f)]:
  - @guardbee/mcp-dependency-auditor@0.4.0

## 0.2.10

### Patch Changes

- Updated dependencies [[`7f87277`](https://github.com/GuardBee/guardbee-mcp/commit/7f872776b62f37f39b60bc35aa0022a61b97b66f), [`fb28be0`](https://github.com/GuardBee/guardbee-mcp/commit/fb28be0bf134ba6334d82a4cdef31484ed93a080)]:
  - @guardbee/mcp-dependency-auditor@0.3.0

## 0.2.9

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-dependency-auditor@0.2.5
  - @guardbee/mcp-dns-intelligence@0.2.4
  - @guardbee/mcp-secret-scanner@0.6.1
  - @guardbee/mcp-ssl-inspector@0.3.1
  - @guardbee/mcp-telemetry@0.1.4

## 0.2.8

### Patch Changes

- Updated dependencies [[`5ff4334`](https://github.com/GuardBee/guardbee-mcp/commit/5ff4334d6037cfd1088bdda5807094400d09a25a)]:
  - @guardbee/mcp-ssl-inspector@0.3.0

## 0.2.7

### Patch Changes

- Updated dependencies [[`4545f53`](https://github.com/GuardBee/guardbee-mcp/commit/4545f53505315149567c063da58526d7b1fc1633)]:
  - @guardbee/mcp-secret-scanner@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7)]:
  - @guardbee/mcp-secret-scanner@0.5.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`1cb3991`](https://github.com/GuardBee/guardbee-mcp/commit/1cb39919ca7a9a944c40d8865f3987b43d908435), [`841d816`](https://github.com/GuardBee/guardbee-mcp/commit/841d81617c76fdfe9849336e5daeee2fe09a1c9d)]:
  - @guardbee/mcp-secret-scanner@0.4.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`149e46f`](https://github.com/GuardBee/guardbee-mcp/commit/149e46fd7c47c5c6dbb194850d49be35c2301c11)]:
  - @guardbee/mcp-secret-scanner@0.3.0

## 0.2.2

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-dependency-auditor@0.2.2
  - @guardbee/mcp-dns-intelligence@0.2.2
  - @guardbee/mcp-secret-scanner@0.2.2
  - @guardbee/mcp-ssl-inspector@0.2.2
  - @guardbee/mcp-telemetry@0.1.2

## 0.2.1

### Patch Changes

- Make English the primary `README.md` (what npm and GitHub display by default) for every package, matching the change already made for `db-gateway`. The previous Turkish content moves to `TR.md`, linked via a language switcher at the top of both files. Docs-only change, no code/behavior changes.
- Updated dependencies []:
  - @guardbee/mcp-dependency-auditor@0.2.1
  - @guardbee/mcp-dns-intelligence@0.2.1
  - @guardbee/mcp-secret-scanner@0.2.1
  - @guardbee/mcp-ssl-inspector@0.2.1
  - @guardbee/mcp-telemetry@0.1.1

## 0.2.0

### Minor Changes

- [`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add usage telemetry via the new `@guardbee/mcp-telemetry` shared package — **on by default**, disable with `GUARDBEE_TELEMETRY=0`. Every tool call reports the tool name, a shape-preserving-redacted version of its parameters, success/failure, and duration to `app.guardbee.ai`.
  
  Redaction (`redactParams`, see `@guardbee/mcp-telemetry`'s README) replaces any string longer than 40 characters, and the value of any `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` key regardless of length, with a `"[redacted: ...]"` placeholder — full file/scan content and real row data are never sent, only short structural parameters like table names or limits. A one-time notice is printed to stderr on first use explaining this and how to opt out. This is a behavior change (these packages now make an outbound network call by default) — previously most of them advertised running entirely offline.

### Patch Changes

- [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add Smithery.ai integration files (`smithery.yaml`, `manifest.json`, `.well-known/mcp/server-card.json`), matching the pattern already used by `@guardbee/mcp-db-gateway`, so these servers are one-click installable from Smithery and discoverable via their MCP server card. No functional/runtime code changes — these files are read from the GitHub repo by Smithery, not from the published npm tarball (`package.json` `files` is unchanged).
- Updated dependencies [[`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967), [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b)]:
  - @guardbee/mcp-dependency-auditor@0.2.0
  - @guardbee/mcp-dns-intelligence@0.2.0
  - @guardbee/mcp-secret-scanner@0.2.0
  - @guardbee/mcp-ssl-inspector@0.2.0
