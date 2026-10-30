# @guardbee/mcp-document-scanner

## 0.4.1

### Patch Changes

- [#247](https://github.com/GuardBee/guardbee-mcp/pull/247) [`30cc59d`](https://github.com/GuardBee/guardbee-mcp/commit/30cc59d169b9e0146e5ca785de7536c4dc4e98b9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool schemas are now declared with `z.object(...)` instead of raw Zod shapes, which MCP SDK v2 deprecates. The JSON Schema sent to clients is unchanged.

## 0.4.0

### Minor Changes

- [#245](https://github.com/GuardBee/guardbee-mcp/pull/245) [`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Move to the MCP TypeScript SDK v2: every server now speaks MCP 2026-07-28 as well as 2025-11-25, choosing per connection (`serveStdio`). Tools without arguments no longer declare an empty input schema. The rug-pull detector and owasp-scan connect to target servers with version negotiation, so they read servers on either revision. `instrumentServer` from `@guardbee/mcp-telemetry` accepts an SDK v1 or v2 server.

### Patch Changes

- Updated dependencies [[`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655)]:
  - @guardbee/mcp-telemetry@0.3.1

## 0.3.0

### Minor Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.

## 0.2.1

### Patch Changes

- [#185](https://github.com/GuardBee/guardbee-mcp/pull/185) [`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `mcp-security-proxy` and `mcp-db-gateway` get an `exports` map (the package root, `./dist/*` for existing deep imports, `package.json`); db-gateway also exports `./adapters/*`, so the documented `import { createPrismaAdapter } from "@guardbee/mcp-db-gateway/adapters/prisma"` now resolves. The proxy moves to ldapts 9 (its older uuid had an advisory). The telemetry package description now says opt-in, the suite's starts with "MCP security suite", and document-scanner's homepage is its README.

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-telemetry@0.3.0
  - @guardbee/guard-core@1.0.1

## 0.2.0

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

## 0.1.10

### Patch Changes

- Updated dependencies [[`9599fb6`](https://github.com/GuardBee/guardbee-mcp/commit/9599fb64249dc38baba3fd4b2d1d7fb82dfd6de3)]:
  - @guardbee/guard-core@0.22.0

## 0.1.9

### Patch Changes

- Updated dependencies [[`c1a16b9`](https://github.com/GuardBee/guardbee-mcp/commit/c1a16b9c9f588c4d3735fb45a1339b33119a8de0)]:
  - @guardbee/guard-core@0.21.0

## 0.1.8

### Patch Changes

- [#160](https://github.com/GuardBee/guardbee-mcp/pull/160) [`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - KVKK Art. 6 special categories and the `KVKK_SENSITIVE` preset ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).
  
  - guard-core: nine new detectors. `health`, `religion_belief`, `ethnic_origin`, `political_opinion`, `union_membership`, `criminal_record`, `sex_life`, `biometric` and `genetic` mask as `[SAĞLIK]`, `[DİN-İNANÇ]`, `[ETNİK-KÖKEN]`, `[SİYASİ-GÖRÜŞ]`, `[SENDİKA]`, `[SABIKA]`, `[CİNSEL-HAYAT]`, `[BİYOMETRİK]` and `[GENETİK]`.
  - How they work: a Turkish and English term list per category, plus a context rule. A term is masked only when the text is about a person: a name from the NER lookup, a personal identifier, or a word that points at someone. The mask grows over the phrase around the term.
  - They are opt-in. They are in no preset except the new `KVKK_SENSITIVE` (`KVKK` plus these), and can also be turned on by name. New exports: `SPECIAL_CATEGORIES` and `SPECIAL_CATEGORY_REPLACEMENT`.
  - security-proxy: `preset: KVKK_SENSITIVE` and the category names are accepted in config. Findings count as personal data in `piiHits`, taint and hooks.
  - document-scanner: the same categories count as personal data.
  - pii-bench has a new hand-written `tr-special-challenge` set. With the name model, per-category F1 there is 86–100, and its clean lines get no false alarms.
- Updated dependencies [[`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16)]:
  - @guardbee/guard-core@0.20.0

## 0.1.7

### Patch Changes

- [#158](https://github.com/GuardBee/guardbee-mcp/pull/158) [`d8bdffe`](https://github.com/GuardBee/guardbee-mcp/commit/d8bdffedeb2e3401ebc8ce6fc5616a17508f24e7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add a `default` export condition so the CommonJS build of `@guardbee/mcp-security-proxy` can load these packages. Without it, `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and `interceptors.documents` threw on every tool call in the published proxy. Needs Node 20.19+ or 22.12+ (require of an ES module).

## 0.1.6

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548)]:
  - @guardbee/guard-core@0.18.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1)]:
  - @guardbee/guard-core@0.17.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69)]:
  - @guardbee/guard-core@0.16.0

## 0.1.2

### Patch Changes

- [#140](https://github.com/GuardBee/guardbee-mcp/pull/140) [`d8cd9cc`](https://github.com/GuardBee/guardbee-mcp/commit/d8cd9cc0524abe68dbb095dc0c28a399ae8eb282) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - CLI: `--cache-path=<dir>` sets where Tesseract language data is cached (the option existed in the API but not on the command line).

## 0.1.1

### Patch Changes

- Updated dependencies [[`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1), [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232)]:
  - @guardbee/guard-core@0.15.0
