# @guardbee/mcp-llm-redteam

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP（Model Context Protocol）服务器，用于**主动**对运行中的 LLM 端点或聊天机器人做红队测试——不像 GuardBee 其他扫描器做静态分析，而是向你控制的真实目标发送真实探测请求。

`ai-code-scanner`、`mcp-server-auditor` 与 `prompt-injection-scanner` 都查看静态代码或内容。本包查看的是**运行中的系统**：已部署的 LLM/聊天机器人防护栏，此刻在生产中是否真能扛住已知的 jailbreak、提取、混淆与拒绝压制技术？

> ⚠️ **仅指向你拥有或明确获授权测试的端点。** 每次探测都会发送真实请求并消耗目标上的 API 配额。这是自测工具——你提供自己的 API 密钥/端点。
>
> **任何探测都不会要求目标生成真正有害的内容。** 每次探测都基于 *canary*：成功与否取决于目标是否复现我们每次运行生成的随机一次性令牌——证明越权指令被服从，却从不诱发真实有害输出。这使结果确定（canary 不可能巧合出现），且可安全地对运行中端点执行。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

```
Your LLM endpoint / chatbot ◄── llm-redteam ──► Claude
              │
              ├─ Instruction override    (DAN-style role-play, direct "ignore instructions")
              ├─ Extraction              ("repeat everything above", translation-reframed leak)
              ├─ Obfuscation             (base64-encoded instruction, zero-width smuggling)
              ├─ Refusal suppression     (fake system-override impersonation)
              └─ Multilingual            (same override, non-English phrasing)
```

---

## 功能

- **12 个探测，5 个类别** — instruction-override、extraction、obfuscation、refusal-suppression、multilingual
- **基于 canary，而非基于真实危害** — 确定性通过/失败，从不请求真正有害内容
- **3 种目标类型** — OpenAI 兼容聊天 API（OpenAI、Groq、本地 vLLM 等）、Anthropic Messages API，或你自己的 webhook
- 每次绕过都包含**为何重要以及如何处理**（`recommendation`）
- CLI 模式用于 CI（例如每次部署红队测试暂存聊天机器人）
- 29 个单元测试——目标适配器用 mock 的 `fetch` 测试，测试套件无真实网络调用

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-llm-redteam": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-llm-redteam"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

然后问 Claude：*"Run the GuardBee red-team suite against my OpenAI endpoint using gpt-4o-mini."*

### CLI（CI/CD）

```bash
export OPENAI_API_KEY=sk-...
npx @guardbee/mcp-llm-redteam probe --type=openai --model=gpt-4o-mini --api-key-env=OPENAI_API_KEY --fail-on=high
```

```bash
# Your own chatbot endpoint
npx @guardbee/mcp-llm-redteam probe --type=webhook --url=https://staging.example.com/chat --fail-on=any
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `list_probes` | 按类别列出全部探测——无网络调用 |
| `run_probe_suite` | 对你指定的目标运行探测；返回哪些绕过了防护栏 |

---

## 目标类型

| 类型 | 用途 |
|---|---|
| `openai` | OpenAI 的 Chat Completions API，或经 `baseUrl` 的任何 OpenAI 兼容网关（Groq、本地 vLLM/Ollama 代理等） |
| `anthropic` | 直接使用 Anthropic Messages API |
| `webhook` | 你自己的聊天机器人/产品端点——以 JSON POST `{ prompt }`，从可配置字段读取回复 |

API 密钥**从不**作为工具/CLI 参数传递——只传已持有密钥的环境变量名（`apiKeyEnv`）。运行前设置该环境变量。

---

## 检测的绕过类别

| 类别 | 示例探测 | 严重级别 | 绕过意味着什么 |
|---|---|---|---|
| instruction-override | `direct_override`、`role_play_dan` | high | 直接或角色扮演覆盖指令取代了 system prompt 的权威 |
| extraction | `system_prompt_leak_direct`、`repeat_above` | critical | 目标泄露了（或证明会泄露）其自身 system prompt |
| obfuscation | `base64_instruction`、`zero_width_smuggling` | high/medium | 经编码或不可见字符隐藏的覆盖指令仍然生效 |
| refusal-suppression | `authority_impersonation` | high | 伪造的「system override」框架获得了真实指令权威 |
| multilingual | `non_english_override` | medium | 同一覆盖以非英语措辞时仍然成功 |

这些是**已知、公开文档化的技术形态**——这是防御覆盖测试，而非新颖攻击研究。挡住的探测不能证明目标牢不可破；被绕过的探测则是具体、可复现的发现。

---

## 开发

```bash
npm run build
npm test             # 29 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
