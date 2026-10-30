# @guardbee/mcp-owasp-scan

## 0.5.1

### Patch Changes

- [#247](https://github.com/GuardBee/guardbee-mcp/pull/247) [`30cc59d`](https://github.com/GuardBee/guardbee-mcp/commit/30cc59d169b9e0146e5ca785de7536c4dc4e98b9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool schemas are now declared with `z.object(...)` instead of raw Zod shapes, which MCP SDK v2 deprecates. The JSON Schema sent to clients is unchanged.
- Updated dependencies [[`30cc59d`](https://github.com/GuardBee/guardbee-mcp/commit/30cc59d169b9e0146e5ca785de7536c4dc4e98b9)]:
  - @guardbee/mcp-audit-gap-auditor@0.4.1
  - @guardbee/mcp-context-oversharing-auditor@0.4.1
  - @guardbee/mcp-config-auditor@0.8.1
  - @guardbee/mcp-server-auditor@0.4.1
  - @guardbee/mcp-oauth-auditor@0.5.1
  - @guardbee/mcp-secret-scanner@1.1.1
  - @guardbee/mcp-tool-poisoning-scanner@0.5.1
  - @guardbee/mcp-toxic-flow-auditor@1.1.1

## 0.5.0

### Minor Changes

- [#245](https://github.com/GuardBee/guardbee-mcp/pull/245) [`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Move to the MCP TypeScript SDK v2: every server now speaks MCP 2026-07-28 as well as 2025-11-25, choosing per connection (`serveStdio`). Tools without arguments no longer declare an empty input schema. The rug-pull detector and owasp-scan connect to target servers with version negotiation, so they read servers on either revision. `instrumentServer` from `@guardbee/mcp-telemetry` accepts an SDK v1 or v2 server.

### Patch Changes

- Updated dependencies [[`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655)]:
  - @guardbee/mcp-audit-gap-auditor@0.4.0
  - @guardbee/mcp-context-oversharing-auditor@0.4.0
  - @guardbee/mcp-config-auditor@0.8.0
  - @guardbee/mcp-server-auditor@0.4.0
  - @guardbee/mcp-oauth-auditor@0.5.0
  - @guardbee/mcp-secret-scanner@1.1.0
  - @guardbee/mcp-telemetry@0.3.1
  - @guardbee/mcp-tool-poisoning-scanner@0.5.0
  - @guardbee/mcp-toxic-flow-auditor@1.1.0

## 0.4.0

### Minor Changes

- [#222](https://github.com/GuardBee/guardbee-mcp/pull/222) [`8c801c8`](https://github.com/GuardBee/guardbee-mcp/commit/8c801c8d64b42d4d0608668a4e8f6920f848246a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Static analysis of Python and Go MCP servers.
  
  - guard-core: `extractPythonTools` / `extractGoTools` read tool definitions (name, description, parameter descriptions, `readOnlyHint`, input names and handler code) from FastMCP / official Python SDK decorators, the low-level `Tool(...)` + `call_tool` form, the official go-sdk and mark3labs/mcp-go; `languageOf`, `ANALYSIS_DEPTH`; `PYTHON_SINK_RULES`, `GO_SINK_RULES`, `sinkRulesFor`. The sensitive-file description rule also matches `~/.cursor/mcp.json`, `claude_desktop_config.json` and `~/.kube/config`; a long camelCase identifier is no longer taken for an encoded blob.
  - tool-poisoning-scanner: description injection and confused-deputy checks on Python and Go servers; findings carry `language` (also in SARIF); `scan_text` takes a `language`.
  - mcp-server-auditor: tool input followed from the tool definition through assignments into shell, file write/delete, HTTP and SQL calls in Python and Go handlers (`python_fs_write_from_tool_input`, `go_shell_from_tool_input`, `go_fs_write_from_tool_input`, `go_ssrf_from_tool_input`, `go_sql_injection_via_tool_input`, and the existing Python ids for FastMCP parameters).
  - oauth-auditor: authlib and python-jose audience checks, `verify_aud: False`, forwarding all request headers, authlib PKCE; Go rules for golang-jwt / jwx audience, go-oidc `SkipClientIDCheck`, header passthrough, hardcoded `ClientSecret`, `strings.HasPrefix` redirect checks, math/rand state, discovery SSRF, shell-opened auth URLs, x/oauth2 PKCE and go-sdk / mcp-go HTTP transports; `token_passthrough_via_variable` for both. Language-specific rules run only on their own language.
  - owasp-scan: the report's `coverage` lists every source file with its language, analysis depth (`full` or `patterns`) and tool definitions found, with a per-language summary in text output.

### Patch Changes

- Updated dependencies [[`f223d34`](https://github.com/GuardBee/guardbee-mcp/commit/f223d34a00dc142167b21bfe2d34ec28c3d8ef2a), [`69b9796`](https://github.com/GuardBee/guardbee-mcp/commit/69b9796faea2f324c65d59b49d2a924da064ba93), [`8c801c8`](https://github.com/GuardBee/guardbee-mcp/commit/8c801c8d64b42d4d0608668a4e8f6920f848246a)]:
  - @guardbee/guard-core@1.4.0
  - @guardbee/mcp-config-auditor@0.7.0
  - @guardbee/mcp-tool-poisoning-scanner@0.4.0
  - @guardbee/mcp-server-auditor@0.3.0
  - @guardbee/mcp-oauth-auditor@0.4.0

## 0.3.3

### Patch Changes

- [#208](https://github.com/GuardBee/guardbee-mcp/pull/208) [`103a94b`](https://github.com/GuardBee/guardbee-mcp/commit/103a94bd39d17e616e75878e03d406575dec82e9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - oauth-auditor checks the attacks the MCP spec's Security Best Practices name that it did not cover ([#203](https://github.com/GuardBee/guardbee-mcp/issues/203)): predictable or unbound state/session handles (state handle hijacking), authorization codes redeemed without an `iss` check (mix-up, RFC 9207), authorization URLs opened without a scheme check or through a shell, and HTTP MCP servers with no authentication, no Host/Origin check (DNS rebinding) or bound to 0.0.0.0. Every finding links its spec section (SARIF `helpUri`) and carries its OWASP MCP Top 10 id; owasp-scan now reports the shell-open rule under MCP05. New `guardbee-oauth-auditor probe <url>`: a read-only check of a running local or private HTTP MCP endpoint for unauthenticated access and foreign Host/Origin acceptance.
- Updated dependencies [[`103a94b`](https://github.com/GuardBee/guardbee-mcp/commit/103a94bd39d17e616e75878e03d406575dec82e9)]:
  - @guardbee/mcp-oauth-auditor@0.3.0

## 0.3.2

### Patch Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.
- Updated dependencies [[`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3)]:
  - @guardbee/mcp-audit-gap-auditor@0.3.2
  - @guardbee/mcp-context-oversharing-auditor@0.3.2
  - @guardbee/mcp-config-auditor@0.6.2
  - @guardbee/mcp-server-auditor@0.2.2
  - @guardbee/mcp-oauth-auditor@0.2.2
  - @guardbee/mcp-secret-scanner@1.0.2
  - @guardbee/mcp-tool-poisoning-scanner@0.3.2
  - @guardbee/mcp-toxic-flow-auditor@1.0.2

## 0.3.1

### Patch Changes

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`ee8718b`](https://github.com/GuardBee/guardbee-mcp/commit/ee8718b0ab9a169473a365818089f84c6b1080b7), [`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-toxic-flow-auditor@1.0.1
  - @guardbee/mcp-tool-poisoning-scanner@0.3.1
  - @guardbee/mcp-server-auditor@0.2.1
  - @guardbee/mcp-audit-gap-auditor@0.3.1
  - @guardbee/mcp-telemetry@0.3.0
  - @guardbee/mcp-context-oversharing-auditor@0.3.1
  - @guardbee/mcp-config-auditor@0.6.1
  - @guardbee/mcp-oauth-auditor@0.2.1
  - @guardbee/mcp-secret-scanner@1.0.1

## 0.3.0

### Minor Changes

- [#172](https://github.com/GuardBee/guardbee-mcp/pull/172) [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `security-suite` now covers every GuardBee scanner and auditor (29 packages, 124 MCP tools). `guardbee serve` serves the recommended group by default (owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor: 31 tools); `--tools=` (or `GUARDBEE_SUITE_TOOLS`) takes groups (`code`, `supply-chain`, `network`, `platform`, `all`) and package ids. Tool names carry their package's prefix (`secrets_scan_text`, `injection_scan_text`) so packages do not collide. `guardbee <package-id> <args>` runs any package's CLI and `guardbee list` lists them; the old `secret-scan`, `dep-audit`, `ssl-inspect` and `dns-check` shortcuts still work. With no arguments and no terminal on stdin (an MCP client starting it), the suite now serves instead of printing help, and its MCP Registry entry passes `serve`.
  
  **Breaking for `guardbee serve` users:** the five plain tool names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`) are now prefixed package tools; see "Upgrading from 0.2" in the README.
  
  Every scanner and auditor package exports `registerTools(server)`, which registers its MCP tools on a given `McpServer`; `startServer()` uses it.

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395), [`c3b71f8`](https://github.com/GuardBee/guardbee-mcp/commit/c3b71f8e1305cbabe0fa733b13f6eb9a95d08513), [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947)]:
  - @guardbee/mcp-audit-gap-auditor@0.3.0
  - @guardbee/mcp-context-oversharing-auditor@0.3.0
  - @guardbee/mcp-config-auditor@0.6.0
  - @guardbee/mcp-server-auditor@0.2.0
  - @guardbee/mcp-oauth-auditor@0.2.0
  - @guardbee/mcp-secret-scanner@1.0.0
  - @guardbee/mcp-tool-poisoning-scanner@0.3.0
  - @guardbee/mcp-toxic-flow-auditor@1.0.0
  - @guardbee/mcp-telemetry@0.2.0

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
