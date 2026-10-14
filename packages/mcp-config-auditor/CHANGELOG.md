# @guardbee/mcp-config-auditor

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
