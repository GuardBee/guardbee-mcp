# @guardbee/mcp-prompt-injection-scanner

## 1.2.0

### Minor Changes

- [#266](https://github.com/GuardBee/guardbee-mcp/pull/266) [`ca17dea`](https://github.com/GuardBee/guardbee-mcp/commit/ca17dea9e1167efcbe36ac0c8b73b3fe3ca941ae) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Optional LLM judge (any OpenAI-compatible endpoint, local by default: Ollama, llama.cpp, vLLM).
  
  - guard-core: `Judge` with `classifyInjection` and `checkAlignment`. It returns schema-checked JSON at temperature 0, with a latency budget and a cache, and reports the model and version. It is off unless configured, and a non-local endpoint needs `allowRemote` and https. Alignment behaviors must quote handler code that really exists, and behaviors the description states are dropped. `judgeFromEnv` reads `GUARDBEE_JUDGE_URL` / `GUARDBEE_JUDGE_MODEL`.
  - tool-poisoning-scanner: `--judge` checks each tool's handler against its description (`judge_description_behavior_mismatch`), with the model in findings and SARIF.
  - prompt-injection-scanner: `--judge` finds paraphrased or translated injections (`judge_semantic_injection`).
  - security-proxy: a `judge` config block. A borderline (warn) injection finding on tool arguments or results is raised to a block when the judge is confident it is malicious; with `mayClear` a confident "benign" clears it. `budgetMs` and `onError` (open/closed) apply. `scope: results` also judges every tool result the rules let through. Audit events carry `judge` (model, version, verdict, confidence, latency, outcome); CEF puts the model in `flexString1`.
  - Benchmark in bench/judge: rules alone vs. judge (qwen2.5:3b, qwen2.5:7b) on 50 English and Turkish injection samples and 16 tool alignment cases.

### Patch Changes

- Updated dependencies [[`ca17dea`](https://github.com/GuardBee/guardbee-mcp/commit/ca17dea9e1167efcbe36ac0c8b73b3fe3ca941ae), [`fb81d57`](https://github.com/GuardBee/guardbee-mcp/commit/fb81d57371b9e06a3ff6c05a8877717276e51a89)]:
  - @guardbee/guard-core@1.5.0

## 1.1.1

### Patch Changes

- [#247](https://github.com/GuardBee/guardbee-mcp/pull/247) [`30cc59d`](https://github.com/GuardBee/guardbee-mcp/commit/30cc59d169b9e0146e5ca785de7536c4dc4e98b9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool schemas are now declared with `z.object(...)` instead of raw Zod shapes, which MCP SDK v2 deprecates. The JSON Schema sent to clients is unchanged.

## 1.1.0

### Minor Changes

- [#245](https://github.com/GuardBee/guardbee-mcp/pull/245) [`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Move to the MCP TypeScript SDK v2: every server now speaks MCP 2026-07-28 as well as 2025-11-25, choosing per connection (`serveStdio`). Tools without arguments no longer declare an empty input schema. The rug-pull detector and owasp-scan connect to target servers with version negotiation, so they read servers on either revision. `instrumentServer` from `@guardbee/mcp-telemetry` accepts an SDK v1 or v2 server.

### Patch Changes

- Updated dependencies [[`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655)]:
  - @guardbee/mcp-telemetry@0.3.1

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

## 0.2.23

### Patch Changes

- Updated dependencies [[`9599fb6`](https://github.com/GuardBee/guardbee-mcp/commit/9599fb64249dc38baba3fd4b2d1d7fb82dfd6de3)]:
  - @guardbee/guard-core@0.22.0

## 0.2.22

### Patch Changes

- Updated dependencies [[`c1a16b9`](https://github.com/GuardBee/guardbee-mcp/commit/c1a16b9c9f588c4d3735fb45a1339b33119a8de0)]:
  - @guardbee/guard-core@0.21.0

## 0.2.21

### Patch Changes

- Updated dependencies [[`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16)]:
  - @guardbee/guard-core@0.20.0

## 0.2.20

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0

## 0.2.19

### Patch Changes

- Updated dependencies [[`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548)]:
  - @guardbee/guard-core@0.18.0

## 0.2.18

### Patch Changes

- Updated dependencies [[`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1)]:
  - @guardbee/guard-core@0.17.0

## 0.2.17

### Patch Changes

- Updated dependencies [[`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69)]:
  - @guardbee/guard-core@0.16.0

## 0.2.16

### Patch Changes

- Updated dependencies [[`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1), [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232)]:
  - @guardbee/guard-core@0.15.0

## 0.2.15

### Patch Changes

- Updated dependencies [[`08cc29e`](https://github.com/GuardBee/guardbee-mcp/commit/08cc29e4ca69af9aaf2bcbbde9f31824c9ada5c7)]:
  - @guardbee/guard-core@0.14.0

## 0.2.14

### Patch Changes

- Updated dependencies [[`13c4c8f`](https://github.com/GuardBee/guardbee-mcp/commit/13c4c8f7afb29c7c373f83b1f64ae518edc08a46)]:
  - @guardbee/guard-core@0.13.0

## 0.2.13

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/guard-core@0.12.1
  - @guardbee/mcp-telemetry@0.1.4

## 0.2.12

### Patch Changes

- Updated dependencies [[`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7)]:
  - @guardbee/guard-core@0.12.0

## 0.2.11

### Patch Changes

- Updated dependencies [[`64aeffa`](https://github.com/GuardBee/guardbee-mcp/commit/64aeffa43ce641738a9858818aa59d88154bf25a)]:
  - @guardbee/guard-core@0.11.0

## 0.2.10

### Patch Changes

- Updated dependencies [[`20bbdc4`](https://github.com/GuardBee/guardbee-mcp/commit/20bbdc49affdebbbfce869d85176ab3b38aa23ce)]:
  - @guardbee/guard-core@0.10.0

## 0.2.9

### Patch Changes

- Updated dependencies [[`659b893`](https://github.com/GuardBee/guardbee-mcp/commit/659b893a82c92f6c579ea50de50b942448c23bea)]:
  - @guardbee/guard-core@0.9.0

## 0.2.8

### Patch Changes

- Updated dependencies [[`34ead6f`](https://github.com/GuardBee/guardbee-mcp/commit/34ead6fb45d6b093c441b28c83d73107ff20d0a3)]:
  - @guardbee/guard-core@0.8.0

## 0.2.7

### Patch Changes

- Updated dependencies [[`aa299d3`](https://github.com/GuardBee/guardbee-mcp/commit/aa299d3d3343bfbf48bc36b78036d7d7cb1565ed)]:
  - @guardbee/guard-core@0.7.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`b8dee60`](https://github.com/GuardBee/guardbee-mcp/commit/b8dee60a6092f16ba1442cafafa60fa842cffd42)]:
  - @guardbee/guard-core@0.6.0

## 0.2.5

### Patch Changes

- [#42](https://github.com/GuardBee/guardbee-mcp/pull/42) [`033dbda`](https://github.com/GuardBee/guardbee-mcp/commit/033dbda55671b1589fcd2afb0344314fa420ff00) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP Registry name moves to `io.github.GuardBee/<server>` (`mcpName`), so the Release workflow can publish it to the registry with GitHub OIDC on every release. Earlier versions stay listed under `io.github.4hmetuyar/<server>`.

## 0.2.4

### Patch Changes

- Updated dependencies [[`b1de97f`](https://github.com/GuardBee/guardbee-mcp/commit/b1de97f5cbeaf1951798970a56917b8378b45848)]:
  - @guardbee/guard-core@0.5.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`75f4bad`](https://github.com/GuardBee/guardbee-mcp/commit/75f4baddd164e252be4f8004e2ec8e0054cbd218)]:
  - @guardbee/guard-core@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35)]:
  - @guardbee/guard-core@0.3.0

## 0.2.1

### Patch Changes

- Docs: add a Simplified Chinese README (`ZH.md`) and link it from the English and Turkish ones. Correct stale counts (secret-scanner: 38 patterns and 39 tests; prompt-injection-scanner: 45 tests) and add a Turkish README for guard-core. No code changes.
- Updated dependencies [`243991e`]:
  - @guardbee/guard-core@0.2.1

## 0.2.0

### Minor Changes

- Shared detectors: one injection rule set, provider secrets, Turkish identifiers.
  
  guard-core
  - `INJECTION_RULES`: the prompt-injection-scanner rules and the security-proxy 0.x phrases in one list (27 rules). New: Turkish instruction override and prompt extraction, `DAN mode`, "bypass safety/guardrails", `<system>` tags, Unicode tag-character smuggling (flag emoji excluded), bidi control characters. `findInjections` also decodes base64 runs that turn into readable text and checks them.
  - Each rule is precise or `broad`. `scanForPromptInjection` blocks only on a precise high/critical rule and warns on the rest.
  - `SECRET_RULES`: the secret-scanner provider formats, moved here.
  - PII masking now covers private key blocks (whole BEGIN…END), connection strings with passwords, 22 provider key and token formats, and VKN (check digit plus a `VKN` / `Vergi No` label). Phone numbers must have a Turkish mobile, landline or 850 code and a +90 / 0 prefix or space/dash grouping, and must not sit inside a URL or id; the generic API-key rule needs a separator and both letters and digits (`tokenization1234567890ab` is no longer masked).
  - New validators: `isValidVkn`, `isValidTrPhone`.
  
  security-proxy
  - Uses the shared rules. A generic phrase alone ("act as", "you are now", "developer mode", "jailbreak", "override policy") now warns instead of blocking; in 1.0 a tool result saying "act as a reverse proxy" was blocked.
  - Masks provider keys, private keys, connection strings and VKN. A 10-digit number that cannot be a Turkish phone number is no longer masked as one, and no longer marks the session as holding sensitive data.
  
  prompt-injection-scanner: 17 rules instead of 10 (the precise ones from guard-core). The HTML-comment and CSS-hidden rules no longer fire on `<!-- prettier-ignore -->`, on a comment that merely mentions "instructions", or on `background-color: white`: they now need instruction-like language ("ignore all/the/previous …", "system prompt", "AI:"). Measured on 1,610 package READMEs, blocking findings went from 20 files to 0.
  
  secret-scanner: rules now come from guard-core; no change in what it reports.

### Patch Changes

- Updated dependencies [`15fb399`]:
  - @guardbee/guard-core@0.2.0

## 0.1.3

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3

## 0.1.2

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.2

## 0.1.1

### Patch Changes

- Make English the primary `README.md` (what npm and GitHub display by default) for every package, matching the change already made for `db-gateway`. The previous Turkish content moves to `TR.md`, linked via a language switcher at the top of both files. Docs-only change, no code/behavior changes.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.1
