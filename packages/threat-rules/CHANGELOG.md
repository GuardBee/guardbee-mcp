## 0.3.4

### Patch Changes

- Updated dependencies [[`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49)]:
  - @guardbee/guard-core@0.19.0
## 0.3.3

### Patch Changes

- Updated dependencies [[`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548)]:
  - @guardbee/guard-core@0.18.0
## 0.3.2

### Patch Changes

- Updated dependencies [[`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1)]:
  - @guardbee/guard-core@0.17.0
## 0.3.1

### Patch Changes

- Updated dependencies [[`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69)]:
  - @guardbee/guard-core@0.16.0
## 0.3.0

### Minor Changes

- [#136](https://github.com/GuardBee/guardbee-mcp/pull/136) [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Security reports: `guardbee-proxy report` builds a periodic report from the audit log (Markdown, HTML or JSON; English or Turkish) with findings mapped to OWASP Top 10 for LLM Applications (2025) and MITRE ATLAS, tied to the audit hash chain and optionally Ed25519-signed; `guardbee-proxy verify-report` checks it. The mapping (`classifyEvent`, `THREAT_CATEGORIES`) lives in guard-core and is shown by threat-rules' new `framework_map` tool.

### Patch Changes

- Updated dependencies [[`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1), [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232)]:
  - @guardbee/guard-core@0.15.0
## 0.2.1

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher
- Updated dependencies [[`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed)]:
  - @guardbee/mcp-telemetry@0.1.4
## 0.2.0

### Minor Changes

- [#30](https://github.com/GuardBee/guardbee-mcp/pull/30) [`395c993`](https://github.com/GuardBee/guardbee-mcp/commit/395c9934d647ebde19f65119b3271ce978d940c9) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Initial release: MCP bridge to Agent Threat Rules (ATR) with GuardBee follow-up scanner hints.
## 0.1.0

### Minor Changes

- Initial release: MCP bridge to Agent Threat Rules (ATR) with GuardBee follow-up scanner hints.
