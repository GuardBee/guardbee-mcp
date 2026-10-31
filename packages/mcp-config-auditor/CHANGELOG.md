# @guardbee/mcp-config-auditor

## 0.9.0

### Minor Changes

- [#268](https://github.com/GuardBee/guardbee-mcp/pull/268) [`53949c6`](https://github.com/GuardBee/guardbee-mcp/commit/53949c627192b2eb3c6eee8cc28341a6eacb7058) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fleet-wide shadow MCP inventory:
  
  - `discover --allowlist-from-dashboard` checks every machine against the organization allowlist managed in the GuardBee dashboard (merged with `--allowlist`).
  - `--grades` adds MCP Index grades to the uploaded inventory.
  - `fetchDashboardAllowlist`, `allowlistUrlFor` and `inventoryKey` are exported.
  - FLEET.md has Jamf, Intune, systemd and CI recipes.

- [#264](https://github.com/GuardBee/guardbee-mcp/pull/264) [`fb81d57`](https://github.com/GuardBee/guardbee-mcp/commit/fb81d57371b9e06a3ff6c05a8877717276e51a89) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - GuardBee MCP Index: A–F trust grades for the servers in the official MCP Registry, rebuilt weekly from their published packages (static scan with the GuardBee scanners, OSV vulnerabilities and malware, Sigstore build provenance, maintenance; rubric in packages/mcp-index/RUBRIC.md).
  
  - guard-core: `loadMcpIndex` (downloads the whole index, cached for a day, so lookups send no names), `lookupMcpGrade` (by what a command launches: npm, PyPI, image), `gradeBelow`, `isMcpGrade`, index types.
  - mcp-config-auditor: `--grades` on `scan <file>` and `discover` shows each server's grade; `--min-grade=<A-F>` reports servers below it (`mcp_index_grade_below_minimum`, MCP04); `--index-url`, `--offline`.
  - security-proxy: `guardbee-proxy init --grades` shows the grades; `--min-grade <A-F>` leaves servers below it out of both the gateway and the client config (they stay in the backup).

### Patch Changes

- Updated dependencies [[`ca17dea`](https://github.com/GuardBee/guardbee-mcp/commit/ca17dea9e1167efcbe36ac0c8b73b3fe3ca941ae), [`fb81d57`](https://github.com/GuardBee/guardbee-mcp/commit/fb81d57371b9e06a3ff6c05a8877717276e51a89)]:
  - @guardbee/guard-core@1.5.0

## 0.8.1

### Patch Changes

- [#247](https://github.com/GuardBee/guardbee-mcp/pull/247) [`30cc59d`](https://github.com/GuardBee/guardbee-mcp/commit/30cc59d169b9e0146e5ca785de7536c4dc4e98b9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool schemas are now declared with `z.object(...)` instead of raw Zod shapes, which MCP SDK v2 deprecates. The JSON Schema sent to clients is unchanged.

## 0.8.0

### Minor Changes

- [#245](https://github.com/GuardBee/guardbee-mcp/pull/245) [`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Move to the MCP TypeScript SDK v2: every server now speaks MCP 2026-07-28 as well as 2025-11-25, choosing per connection (`serveStdio`). Tools without arguments no longer declare an empty input schema. The rug-pull detector and owasp-scan connect to target servers with version negotiation, so they read servers on either revision. `instrumentServer` from `@guardbee/mcp-telemetry` accepts an SDK v1 or v2 server.

### Patch Changes

- Updated dependencies [[`29bac2f`](https://github.com/GuardBee/guardbee-mcp/commit/29bac2f679cf97fd48d3d09eef80f328d77f5655)]:
  - @guardbee/mcp-telemetry@0.3.1

## 0.7.0

### Minor Changes

- [#219](https://github.com/GuardBee/guardbee-mcp/pull/219) [`69b9796`](https://github.com/GuardBee/guardbee-mcp/commit/69b9796faea2f324c65d59b49d2a924da064ba93) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Provenance for PyPI packages and container images. `uvx` / `uv tool run` upstreams are checked against PEP 740 attestations (every file of the release, signed by its Trusted Publisher's workflow) and pinned to `pkg==<version>`; `docker run` / `podman run` upstreams resolve the tag to a digest, verify the image's cosign keyless signature (expected signer: the image owner's GitHub account on ghcr.io, or `provenance.signers`) and run pinned to `image@sha256:…`. `guardbee-proxy provenance --format sarif` writes the findings for code scanning. guard-core adds `checkPypiProvenance`, `checkOciProvenance`, `parseImageReference` and `pypiAttestationToBundle`, and `parseLaunch` skips uvx options that take a value. mcp-config-auditor flags `docker run` servers started by tag (`unpinned_container_image`).

## 0.6.2

### Patch Changes

- [#189](https://github.com/GuardBee/guardbee-mcp/pull/189) [`d6b75fe`](https://github.com/GuardBee/guardbee-mcp/commit/d6b75fe26af9f074d87d92d063b6f355fdcc61d3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - - **Node 22 for the proxy, document-scanner and security-suite** (`engines.node: ">=22"`): ldapts 9 and unpdf, which they depend on, require it. Node 18 and 20 are past end of life; the other packages still run on Node 18.
  - **`require()` works for every ESM package**: each `exports` entry gains a `default` condition next to `import` (Node 20.19+ / 22.12+ can `require()` ESM), so `require("@guardbee/mcp-secret-scanner")` no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
  - **`guardbee-proxy --help` / `--version`** print usage and the version instead of failing with "No proxy target configured"; **`guardbee-gateway --help` / `--version`** no longer start the stdio server, and an unknown argument is an error.
  - The proxy's npm description starts with "MCP security gateway" again.

## 0.6.1

### Patch Changes

- [#178](https://github.com/GuardBee/guardbee-mcp/pull/178) [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - MCP tools are registered with `server.registerTool(name, { description, inputSchema, annotations }, handler)` instead of the deprecated `server.tool(...)` (132 registrations, no change to tool names, descriptions or parameters). `@modelcontextprotocol/sdk` is now required at `^1.30.0` instead of `^1.0.0` / `>=1.0.0`, so an install cannot resolve an old SDK the code was never tested with. `@guardbee/mcp-telemetry`'s `instrumentServer` wraps `registerTool` as well as `tool`.

- [#175](https://github.com/GuardBee/guardbee-mcp/pull/175) [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Smaller npm packages (55% less unpacked in total; the proxy 944 → 513 kB): source maps and compiled tests are no longer published (the sources they point at never were), and the translated READMEs stay on GitHub, linked from the English one. Package descriptions now start with what people search for ("MCP gateway and LLM firewall", "Secret scanner for code, git history and AI agent transcripts") and carry more search keywords.
- Updated dependencies [[`12487ab`](https://github.com/GuardBee/guardbee-mcp/commit/12487abec2f0a8bc00b04fee1f8b62e64329c98b), [`c89dc93`](https://github.com/GuardBee/guardbee-mcp/commit/c89dc93bd04e53bc8b72806f279531676b8defcc), [`341a283`](https://github.com/GuardBee/guardbee-mcp/commit/341a2839d56a312f1cb1998a523eb7ea985345db)]:
  - @guardbee/mcp-telemetry@0.3.0

## 0.6.0

### Minor Changes

- [#172](https://github.com/GuardBee/guardbee-mcp/pull/172) [`9ae575f`](https://github.com/GuardBee/guardbee-mcp/commit/9ae575f89aa40b13463460504f12b70011c14947) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `security-suite` now covers every GuardBee scanner and auditor (29 packages, 124 MCP tools). `guardbee serve` serves the recommended group by default (owasp-scan, secret-scanner, prompt-injection-scanner, toxic-flow-auditor, mcp-config-auditor, dependency-auditor: 31 tools); `--tools=` (or `GUARDBEE_SUITE_TOOLS`) takes groups (`code`, `supply-chain`, `network`, `platform`, `all`) and package ids. Tool names carry their package's prefix (`secrets_scan_text`, `injection_scan_text`) so packages do not collide. `guardbee <package-id> <args>` runs any package's CLI and `guardbee list` lists them; the old `secret-scan`, `dep-audit`, `ssl-inspect` and `dns-check` shortcuts still work. With no arguments and no terminal on stdin (an MCP client starting it), the suite now serves instead of printing help, and its MCP Registry entry passes `serve`.
  
  **Breaking for `guardbee serve` users:** the five plain tool names (`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`) are now prefixed package tools; see "Upgrading from 0.2" in the README.
  
  Every scanner and auditor package exports `registerTools(server)`, which registers its MCP tools on a given `McpServer`; `startServer()` uses it.

### Patch Changes

- [#170](https://github.com/GuardBee/guardbee-mcp/pull/170) [`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Package hygiene: every package now ships its LICENSE and CHANGELOG.md, and has a homepage (its guardbee.ai page), a bugs link, `engines.node` and the `guardbee`, `mcp` and `security` keywords. READMEs gain npm badges and a feedback section pointing to GitHub Discussions; the owasp-scan README documents every mode, option, MCP tool and the OWASP coverage.
  
  **Telemetry is now opt-in.** Nothing is sent unless `GUARDBEE_TELEMETRY=1` (or `true`/`on`/`yes`) is set; `GUARDBEE_TELEMETRY=0` is no longer needed. When it is on, the one-time stderr notice says what is sent and to which endpoint.
- Updated dependencies [[`c71f728`](https://github.com/GuardBee/guardbee-mcp/commit/c71f7284c88f36435d0b2f951d5f167781f89395)]:
  - @guardbee/mcp-telemetry@0.2.0

## 0.5.0

### Minor Changes

- [#137](https://github.com/GuardBee/guardbee-mcp/pull/137) [`29b478f`](https://github.com/GuardBee/guardbee-mcp/commit/29b478f7106d6001cf113e8c2ed112a9d83ad7c9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Shadow MCP discovery: also reads Gemini CLI, Cline and Zed configs (JSON with comments, `context_servers`) and Claude Code's per-project servers; `discover --format=json` adds a secret-free inventory (env and header names only, redacted arguments and URLs, package version and pinning, findings per server); `--upload` sends it to the GuardBee dashboard with a workspace API key.

## 0.4.1

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-telemetry@0.1.4

## 0.4.0

### Minor Changes

- [#33](https://github.com/GuardBee/guardbee-mcp/pull/33) [`16634d3`](https://github.com/GuardBee/guardbee-mcp/commit/16634d383623d377de696027112c0618decc092d) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add OWASP MCP09 Shadow MCP host discovery (`discover` CLI + MCP tools) with organization allowlist matching for server names, packages, and remote hosts.

## 0.3.0

### Minor Changes

- [#8](https://github.com/GuardBee/guardbee-mcp/pull/8) [`e9cd29c`](https://github.com/GuardBee/guardbee-mcp/commit/e9cd29c9e92f9ce02e7f26d7c8a37ccdb782afe9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Audit agent SKILL.md files for unrestricted shell and write tools, instruction override, credential reads, literal secrets, and lookalike skill names.

## 0.2.0

### Minor Changes

- [#6](https://github.com/GuardBee/guardbee-mcp/pull/6) [`7f0e01f`](https://github.com/GuardBee/guardbee-mcp/commit/7f0e01f9b15e033928c395ccffbb0118842a604c) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add an MCP client-config auditor, live tool-catalog poisoning checks, cross-server tool shadowing, and proxy guards for tool-result injection and mid-session definition drift. Findings that these checks emit carry OWASP MCP Top 10 tags.

### Patch Changes

- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3
