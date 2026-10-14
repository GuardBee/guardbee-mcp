# @guardbee/mcp-unbounded-consumption-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器，用于扫描 LLM/agent 应用代码中的 **Unbounded Consumption（无界消耗）**——OWASP LLM Top 10 2026 的第 6 类，也称为“denial of wallet”：没有任何东西阻止应用发起无限次可计费调用。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含被扫描的代码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► unbounded-consumption-auditor ──► your LLM/agent source
              │
              ├─ missing-token-limit    (no cap on how much the model can generate)
              ├─ missing-timeout        (a hand-rolled call to an LLM endpoint that can hang forever)
              ├─ unbounded-loop         (an agent/retry loop with no iteration cap)
              ├─ disabled-safety-limit  (a framework's own loop cap explicitly turned off)
              └─ missing-rate-limit     (an MCP tool making billable calls with no throttling)
```

OWASP 对该类别的自身说明给出了一个阅读发现时值得牢记的具体成本示例：*"A research assistant agent without any recursion limit or call budget ended up making 500 tool calls with a simulated cost of $10... An agent with a call budget, a recursion depth limit and an agentic circuit breaker... completed one tool call, spending just $0.02."*

---

## 为什么特别是这五项检查

这里的每种模式在写之前都对照过真实 SDK 源码或真实代码——不是从训练数据假设中猜出来的。

- **Missing token limit** 针对既未设置 `max_tokens` 也未设置 `max_completion_tokens` 的 `.chat.completions.create(...)` 调用（OpenAI Python/JS）。刻意仅限定 OpenAI 形态的调用：Anthropic 自身的 SDK 把 `max_tokens` 作为**必需**构造参数——请求尚未发送就会 raise——因此在那里做匹配检查会是 100% 误报。推理模型（o1+）会静默忽略 `max_tokens` 而需要 `max_completion_tokens`，因此检查仅在调用*两者都*缺失时标记。
- **Missing timeout** 针对手写的 `requests`/`axios`/`fetch` 调用，其参数跨度提到已知 LLM 端点（`api.openai.com`、`api.anthropic.com`、`/chat/completions`、`/v1/messages`）。官方 OpenAI/Anthropic SDK 已自带有界客户端级默认值（openai-node: 600s）— 标记那些只会是噪声。`requests.post()` 自身的 Quickstart 警告：未设置 `timeout` 可能让程序无限等待；axios 与裸 `fetch` 有同样的无默认超时形态。
- **Unbounded loop** 覆盖两种真实形态，均经真实代码验证：手写的 `while True:`/`while(true)` agent 循环分发 `tool_calls` 且附近没有任何东西暗示迭代上限（正是公开 70 行 agent 演练中引用的形态），以及捕获异常后直接回调 LLM 并 `continue`、无尝试计数器的重试循环（OWASP 自身说明按名称点出：*"a failed step might be retried repeatedly"*）。重试循环检查刻意限定为实际调用 LLM 的循环——早期版本没有该限定，在测试真实开源代码库时标记了普通轮询/重试代码（见下方开发）。
- **Disabled safety limit** 标记 `max_iterations=None`（LangChain 的 `AgentExecutor`）与 `max_turns=None`（openai-agents-python 的 `Runner.run`/`run_sync`）— 发布前均对照真实源码验证。LangChain 的 `AgentExecutor` 默认 `max_iterations` 为 15，其自身 `_should_continue()` 仅在 `if self.max_iterations is not None` 时强制上限——因此 `None` 确实禁用它。openai-agents-python 自身的 issue tracker 明确表示 `max_turns=None` 禁用轮次限制。**LangGraph 的 `recursion_limit` 没有等价物——它要求具体数字——因此没有为其发布模式**，而不是猜测未验证的“禁用”机制。
- **Missing rate limit** 是这里唯一的启发式模式，故意以 medium（而非 high/critical）严重级别发布：没有任何 MCP SDK（TypeScript 或 Python）在工具注册上提供内置的按调用方节流钩子，不像 LangChain/LangGraph 为迭代上限自带的有界默认值。多篇独立的 2026 文章将修复描述为围绕 `server.tool()`/`@mcp.tool()` 的手写包装，暗示没有可回退的框架默认值。此检查看不见在别处强制的限流（API 网关、另一文件中的中间件）— 见限制。

**与 `ai-code-scanner` 的关系：** 该包已有更粗的 `unbounded_agent_loop` 模式（在 `.chat.completions.create`/`.messages.create` 调用 200 字符内的任意 `while(true)`/`for(;;)`，归入其 `excessive-agency` 类别）— 它不检查循环是否实际分发工具调用，也不检查附近是否有迭代上限提示，因此也会标记已经正确有界的循环。本包的 `unbounded_tool_calling_loop` 更窄且面向成本：它要求实际的 `tool_calls`/`toolCalls` 引用（真实的 agentic 分发形态），并显式跳过附近有可见上限提示的循环。

---

## 功能

- 5 个类别下 7 种模式，每种都扎根于真实 SDK 源码、真实代码演练或 OWASP 自身 2026 说明——在模式注释中内联引用
- 25 个测试（每种模式正例 + 负例，包括无界循环检查所基于的确切引用的真实世界循环片段）
- SARIF 2.1.0 输出 — CI/CD 集成（GitHub Code Scanning 等）
- 已对植入漏洞的 fixture 做端到端验证（全部 7 种模式捕获，全部 3 个“安全对应”负例正确跳过），并对真实的 3,414 文件开源代码库（`IBM/mcp-context-forge`）加上本 monorepo 自身的 495 个文件——生产代码零误报。验证期间*确实*发现并修复了两个真实误报，然后才发布：早期更宽的循环体窗口让文件中较远处无关的 `except`/`continue` 被误认为附近循环的一部分（通过要求窗口内有 LLM 调用提示并缩小窗口修复），以及循环下方几行的已禁用 `max_iterations=None` 曾被短暂误认为合法的附近迭代上限（通过在测试真实上限前剥离已禁用上限赋值修复）。

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-unbounded-consumption-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-unbounded-consumption-auditor"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-unbounded-consumption-auditor scan . --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描代码片段中的 Unbounded Consumption 反模式 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描目录 |
| `list_patterns` | 列出本审计器检测的每种模式，按类别分组 |

---

## 检测模式

| 模式 | 类别 | 严重级别 | 含义 |
|---|---|---|---|
| `openai_chat_completion_missing_max_tokens` | missing-token-limit | medium | OpenAI chat completion 调用既未设置 `max_tokens` 也未设置 `max_completion_tokens` |
| `raw_http_call_to_llm_endpoint_missing_timeout` | missing-timeout | medium | 对手写的已知 LLM 端点 HTTP 调用没有 timeout/AbortSignal |
| `unbounded_tool_calling_loop` | unbounded-loop | medium | 手写的 `while(true)`/`while True:` 循环分发 `tool_calls` 且无可见迭代上限 |
| `unbounded_retry_loop` | unbounded-loop | medium | 围绕 LLM 调用的重试循环捕获异常并 continue，无尝试计数器 |
| `langchain_max_iterations_disabled` | disabled-safety-limit | high | LangChain 的 `AgentExecutor` `max_iterations` 显式设为 `None` |
| `openai_agents_max_turns_disabled` | disabled-safety-limit | high | openai-agents-python 的 `Runner` `max_turns` 显式设为 `None` |
| `mcp_tool_billable_call_no_rate_limit` | missing-rate-limit | medium | MCP 工具处理器发起可计费 LLM 调用，且没有任何东西暗示按调用方限流 |

---

## 配置（`guardbee.yml`）

```yaml
unbounded-consumption-auditor:
  fail-on: high         # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## 限制（设计如此）

- **有界窗口启发式，而非真正的控制流分析。** 循环检查看的是 `while True:`/`while(true)` 之后的固定字符窗口，而非实际循环体——体异常长的循环，或其上限检查落在窗口外的循环，可能被漏掉。对照真实代码的测试也发现了相反的失败模式（较远处无关的 `except`/`continue` 被误认为附近循环的一部分）并相应收紧了窗口；它仍是启发式，不是解析器。
- **限流检查看不见别处的强制。** 自身体内无限流器的工具处理器仍可能被 API 网关、另一文件中的中间件，或本扫描器不追踪进入的包装保护——此检查标记处理器自身可见的内容，仅此而已。
- **无跨函数默认检测。** 若项目集中设置一次输出上限或超时，且每个调用点隐式依赖该默认值（而非按调用传递），这里的按调用检查仍会单独标记每个调用点。
- **不检查 LangGraph 的 `recursion_limit`。** 与 LangChain 和 openai-agents-python 不同，LangGraph 的递归限制要求具体数字——没有已验证的“设为禁用”机制，因此没有为其发布模式，而不是猜测一个。

---

## 开发

```bash
npm run build
npm test             # 25 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
