# @guardbee/mcp-memory-poisoning-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP（Model Context Protocol）服务器，用于扫描 agent 代码中的**记忆投毒（memory poisoning）**——不可信输入被写入 agent 的*持久化、跨会话*记忆，之后被召回并作为可信上下文回喂给模型，且可能发生在完全无关的未来会话中。

`prompt-injection-scanner` 捕获的是模型一次性读取的内容（文档、抓取页面）中的注入载荷。本包捕获的是结构上不同的东西：那种让注入载荷变成模型当作自身长期知识的一部分的代码模式——相当于反射型 XSS 与存储型 XSS 的差距，只是作用在 agent 的记忆上，而不是浏览器的 DOM。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

```
Claude ──► memory-poisoning-scanner ──► Your agent's source
              │
              ├─ memory-write     (untrusted input persisted into archival/core memory or a vector KB)
              └─ memory-readback  (recalled memory fed into a system/assistant-role message or prompt)
```

---

## 为什么普通对话记忆不在范围内

`ConversationBufferMemory` 保存原始聊天轮次，或普通的 `chatHistory.push({role: "user", content: userInput})`，完全正常——那只是对话历史，不是漏洞。本包刻意**不会**标记这些。

真正针对的范围更窄、风险更高：写入*持久化*记忆，且会活过当前对话——MemGPT 风格的归档记忆（在未来无关会话中召回）和核心记忆（按设计在*每一*轮重新注入系统提示），或作为长期知识库而非按对话 RAG 上下文使用的向量存储。若不可信输入未清洗就落在那里，它影响的不只是当前交换——它会成为 agent 认为真实的一部分，对任何人、无限期，直到有人碰巧注意到。

风险的另一半是对称的：记忆/向量检索结果直接流入 `system`/`assistant` 角色消息或提示模板，正是被投毒的记忆“兑现”为模型服从的指令（而非仅读取的数据）之处。

---

## 功能

- **5 种 memory-write 模式**：MemGPT `archival_memory_insert`/`core_memory_append`/`core_memory_replace` 喂入原始输入，向量存储 `add_texts`/`add_documents`/`upsert` 喂入原始输入，以及对自定义命名的长期记忆/知识库存储的通用兜底
- **3 种 memory-readback 模式**：归档/向量检索结果流入 system/assistant 角色消息，或直接插值进提示模板
- SARIF 2.1.0 输出 — CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 17 个单元测试 — 每种模式各有正例与负例（误报）场景，包括显式检查普通对话缓冲用法产生零发现。已对真实植入漏洞的 fixture 做端到端验证（同时捕获写入与回读），并对整个 guardbee-mcp monorepo（386 个文件，生产代码零误报）验证

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-memory-poisoning-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-memory-poisoning-scanner"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-memory-poisoning-scanner scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描代码片段 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描目录 |
| `list_patterns` | 按类别列出所有支持的模式 |

---

## 检测模式

| 类别 | 模式 | 严重级别 |
|---|---|---|
| memory-write | `archival_memory_insert_raw_input` | critical |
| memory-write | `core_memory_write_raw_input` (append/replace) | critical |
| memory-write | `vector_store_add_raw_input` | high |
| memory-write | `generic_named_memory_write_raw_input` | medium |
| memory-readback | `archival_memory_feeds_trusted_role` | critical |
| memory-readback | `vector_retrieval_feeds_trusted_role` | high |
| memory-readback | `memory_retrieval_feeds_prompt_template` | high |

---

## 配置（`guardbee.yml`）

```yaml
memory-poisoning-scanner:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## 限制（设计如此）

- **启发式，非污点追踪。** 写入与回读检查各自看一个有界位置，而不是从某次写入到某次后续读取的已证明数据流路径。发现表示代码中存在风险的*形态*，而非数学上确认的利用链。
- **模式覆盖基于 MemGPT 术语与通用 JS 命名。** 使用完全不同函数/变量名的自建长期记忆系统，除非碰巧匹配通用模式（`*memory*`/`*knowledge_base*` 命名，或 `vectorstore` 风格 API），否则不会被识别。
- 本工具发现的是**使记忆投毒成为可能的代码模式**，而非运行时实际被投毒的记忆存储——若可直接检查记忆内容，请搭配 `prompt-injection-scanner`（用于扫描实际存储内容）。

---

## 开发

```bash
npm run build
npm test             # 17 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
