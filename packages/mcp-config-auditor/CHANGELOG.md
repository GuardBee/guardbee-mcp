# @guardbee/mcp-config-auditor

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
