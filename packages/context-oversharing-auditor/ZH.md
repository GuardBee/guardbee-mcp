# @guardbee/mcp-context-oversharing-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP 服务器，用于审计智能体 / MCP 源码中的 **OWASP MCP10:2025 — 上下文过度共享（context oversharing）**。

[`toxic-flow-auditor`](../toxic-flow-auditor/ZH.md) 评估的是*工具目录*能否串联 lethal trifecta（致命三要素）。本包回答 MCP10 的另一个问题：处理函数返回的会话、记忆或系统上下文，是否超过当前用户 / 租户应看到的范围？

> 本包默认发送使用遥测（工具名 + 较短参数；绝不包含被扫描的代码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

## 检测内容

| 模式 | 严重级别 | 含义 |
|---|---|---|
| `tool_dumps_full_conversation` | critical | 工具返回完整的 `messages` / 对话历史 |
| `unscoped_memory_recall_tool` | high | `dump_memory` / `get_all_memories` 类工具 |
| `shared_global_session_store` | high | 没有按用户分键的全局 session Map/dict |
| `system_prompt_exposed_via_tool` | high | 工具返回 `systemPrompt` / 开发者指令 |
| `cross_session_tool_result_reuse` | medium | 先前工具结果混入另一会话的上下文 |
| `vector_query_without_filter` | high | 向量 / RAG 检索没有租户 / 用户 metadata 过滤 |

## 快速开始

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
