# @guardbee/mcp-context-oversharing-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md)

An MCP server that audits agent/MCP source for **OWASP MCP10:2025 — context oversharing**.

[`toxic-flow-auditor`](../toxic-flow-auditor) grades whether a *tool catalog* can chain the lethal trifecta. This package asks a different MCP10 question: does a handler return more session, memory, or system context than the current user/tenant should see?

> This package sends usage telemetry by default (tool name + short parameters; scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

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
