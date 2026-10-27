# @guardbee/mcp-ai-code-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP（Model Context Protocol）服务器，用于扫描代码库中常见于 LLM/AI 集成的安全模式。

`secret-scanner` 查找泄露的密钥/API 密钥，而本包查找的是**模式**：模型输出被信任到什么程度、它可调用的工具权限有多高、哪些数据被发送给第三方 LLM——这些是静态凭据扫描抓不到的风险。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

```
Claude ──► ai-code-scanner ──► Your codebase
              │
              ├─ Client-exposure    (dangerouslyAllowBrowser: true)
              ├─ Output handling    (eval(llmOutput), unvalidated JSON.parse)
              ├─ Excessive agency   (an agent tool named execute_command)
              ├─ Data privacy       (email/national ID interpolated directly into a prompt)
              └─ Prompt injection   (raw request data mixed into a system prompt)
```

---

## 功能

- **10 个模式，5 个类别** — client-exposure、output-handling、excessive-agency、data-privacy、prompt-injection
- 每条发现都包含**为何有风险以及如何处理**（`recommendation`）——不只是「找到了」
- SARIF 2.1.0 输出——便于 CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- **自定义规则包** — 通过 JSON 文件扩展检测（KVKK/GDPR 字段名、内部工具名等组织特定模式），无需 fork
- 36 个单元测试——每个内置模式都有正向与负向（误报）场景，外加自定义规则加载/校验

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-ai-code-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-ai-code-scanner"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-ai-code-scanner scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描给定文本/代码片段 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描目录（自动跳过 `node_modules`、`.git`、`dist`） |
| `list_patterns` | 按类别列出全部支持的模式 |

---

## 检测模式

| 类别 | 模式 | 严重级别 | 含义 |
|---|---|---|---|
| client-exposure | `openai_dangerously_allow_browser` | critical | OpenAI 密钥泄露到浏览器 |
| client-exposure | `client_bundled_ai_api_key` | critical | AI 密钥经 `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` 进入客户端打包 |
| output-handling | `eval_llm_output` | critical | 模型输出经 `eval()`/`Function()` 当作代码执行 |
| output-handling | `exec_llm_output` | critical | 模型输出传入 shell 命令（命令注入） |
| output-handling | `llm_output_dangerously_set_inner_html` | high | 模型输出以原始 HTML 渲染（XSS） |
| output-handling | `llm_json_no_validation` | medium | 模型输出未经 schema 校验就 `JSON.parse` |
| excessive-agency | `excessive_agency_tool_name` | high | 授予智能体 shell/代码执行能力的工具 |
| excessive-agency | `unbounded_agent_loop` | medium | 无迭代上限的智能体循环（成本/DoS） |
| data-privacy | `pii_field_in_llm_prompt` | high | 邮箱/身份证号/卡号等数据直接进入 prompt |
| prompt-injection | `unsanitized_input_in_system_prompt` | medium | 原始请求/用户数据混入 system prompt |

这些是**启发式**发现——静态文本模式扫描，而非完整 AST 分析。设计目标是低误报率，但每条发现仍应人工复核。

---

## 配置（`guardbee.yml`）

```yaml
ai-code-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  rules-dir: .guardbee/rules   # custom rule packs, see below
  exclude:
    - ".test.ts"
    - "fixtures/"
```

---

## 自定义规则

内置模式覆盖常见 AI/LLM 集成错误，但字段名与内部约定（例如哪些属性名携带受 KVKK 监管的数据）因项目而异。将一个或多个 JSON 文件放入 `.guardbee/rules/`（可通过 `rules-dir` 配置），扫描时会与内置规则合并——CLI 与 MCP 服务器均适用（`list_patterns` 会将其标记为 `(custom)`）。

一个文件可包含单个规则对象或规则数组：

```json
{
  "id": "kvkk_musteri_tc_no",
  "name": "musteriTcNo interpolated into a prompt",
  "category": "data-privacy",
  "pattern": "musteriTcNo",
  "flags": "gi",
  "severity": "high",
  "recommendation": "Mask the national ID before it enters the prompt."
}
```

`category` 为 `client-exposure | output-handling | excessive-agency |
data-privacy | prompt-injection | cost-control` 之一；`severity` 为
`critical | high | medium | low` 之一。`pattern` 是 JS 正则源字符串
（`flags` 默认为 `"g"`）。与内置或其他自定义规则冲突的规则 id 会被拒绝——扫描器继续运行，但会在 stderr 报告问题并跳过该条目。

---

## 开发

```bash
npm run build
npm test             # 36 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
