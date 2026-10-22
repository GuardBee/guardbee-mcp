# @guardbee/mcp-context-oversharing-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-context-oversharing-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-context-oversharing-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-context-oversharing-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-context-oversharing-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor/LICENSE)

An MCP server that audits agent/MCP source for **OWASP MCP10:2025 — context oversharing**.

[`toxic-flow-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor) grades whether a *tool catalog* can chain the lethal trifecta. This package asks a different MCP10 question: does a handler return more session, memory, or system context than the current user/tenant should see?

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

## What it flags

| Pattern | Severity | Meaning |
|---|---|---|
| `tool_dumps_full_conversation` | critical | Tool returns full `messages` / conversation history |
| `unscoped_memory_recall_tool` | high | `dump_memory` / `get_all_memories`-style tools |
| `shared_global_session_store` | high | Global session Map/dict without per-user keys |
| `system_prompt_exposed_via_tool` | high | Tool returns `systemPrompt` / developer instructions |
| `cross_session_tool_result_reuse` | medium | Prior tool results mixed into another session's context |
| `vector_query_without_filter` | high | Vector/RAG search with no tenant/user metadata filter |

## Quick start

```json
{
  "mcpServers": {
    "guardbee-context-oversharing-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-context-oversharing-auditor"]
    }
  }
}
```

```bash
npx @guardbee/mcp-context-oversharing-auditor scan ./src --format=sarif
```

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
