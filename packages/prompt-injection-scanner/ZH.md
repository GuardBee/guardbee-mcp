# @guardbee/mcp-prompt-injection-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器，用于扫描**内容**——RAG 文本块、抓取的网页、文档——中的间接 prompt 注入载荷。

`ai-code-scanner` 和 `mcp-server-auditor` 扫描的是代码；本包扫描的是**数据**。在经典的 prompt 注入中，攻击者自己编写恶意 prompt；而在间接 prompt 注入中，攻击者根本不与模型对话——而是把指令嵌入模型之后会读取的文档、网页或工具结果中。一旦模型通过 RAG 检索或网页抓取把这些内容拉入上下文，嵌入的指令看起来就拥有与用户自己的指令相同的权威。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含被扫描的内容——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
网页 / RAG 文档 ──► prompt-injection-scanner ──► LLM 上下文
              │
              ├─ 指令覆盖       ("ignore all previous instructions"、"önceki talimatları yok say")
              ├─ 角色伪造       ("System:"、<|im_start|>、[INST]、<system>)
              ├─ 隐藏文本       (零宽字符、Unicode tag 字符、bidi 控制符、display:none + 指令、HTML 注释)
              ├─ 直接称呼       ("Dear AI, ...")
              └─ 数据外泄       (索要系统提示词、数据 → URL 指令、带模板的图片信标)
```

---

## 功能

- **17 个模式，5 个类别** —— instruction-override、role-spoofing、hidden-text、direct-address、exfiltration。支持英文和土耳其语表述
- 规则位于 [`@guardbee/guard-core`](../guard-core/README.md)，与 `@guardbee/mcp-security-proxy` 共用，因此本扫描器报告的短语，正是代理在运行时拦截的短语
- 每个发现都包含**为什么有风险以及该怎么做**（`recommendation`）——而不只是"发现了"
- SARIF 2.1.0 输出 —— 便于 CI/CD 集成（例如在每个 PR 上自动扫描知识库仓库）
- 支持通过 `guardbee.yml` 进行配置
- 45 个单元测试 —— 每个模式都有一个正例和一个反例（误报）场景；emoji ZWJ 序列、普通的 `display:none` 弹窗、旗帜 emoji 等已知误报来源都有专门测试

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-prompt-injection-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-prompt-injection-scanner"]
    }
  }
}
```

### CLI（CI/CD —— 例如在每个 PR 上扫描 RAG 知识库仓库）

```bash
npx @guardbee/mcp-prompt-injection-scanner scan ./knowledge-base --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描给定的文本/文档片段 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描目录（例如 RAG 知识库）（自动跳过 `node_modules`、`.git`、`dist`） |
| `list_patterns` | 按类别列出所有支持的模式 |

---

## 检测的模式

| 类别 | 模式 | 严重度 | 含义 |
|---|---|---|---|
| instruction-override | `instruction_override_phrase` | high | 经典的覆盖短语，如 "ignore/disregard/forget previous instructions" |
| instruction-override | `instruction_override_tr` | high | 土耳其语形式："önceki talimatları yok say / unut / görmezden gel" |
| instruction-override | `dan_mode` | high | 要求进入 "DAN mode" 越狱人格 |
| instruction-override | `bypass_safety` | high | 让模型绕过或关闭其安全措施 / guardrails |
| role-spoofing | `system_role_spoof` | medium | 内容中位于行首的伪造 "System:" 角色标签 |
| role-spoofing | `chat_template_marker_injection` | high | 内容中出现的原始聊天模板控制标记（`<\|im_start\|>`、`[INST]`） |
| role-spoofing | `system_tag` | high | 试图把数据伪装成系统消息的 `<system>` 标签 |
| hidden-text | `hidden_zero_width_chars` | medium | 零宽空格/零宽连接符（U+200B/U+2060）——对人工审阅者隐藏的文本 |
| hidden-text | `unicode_tag_smuggling` | critical | 携带隐藏文本的不可见 Unicode tag 字符（U+E0000–E007F）；🏴󠁧󠁢󠁥󠁮󠁧󠁿 等旗帜 emoji 除外 |
| hidden-text | `bidi_control_chars` | medium | 使文本显示顺序与读取顺序不同的双向（bidi）覆盖/隔离字符 |
| hidden-text | `css_hidden_text_with_instruction` | high | `display:none`/白底白字元素中包含类似指令的语言 |
| hidden-text | `html_comment_instruction` | high | HTML 注释中包含类似指令的语言 |
| direct-address | `direct_address_to_ai` | medium | 内容直接称呼 "the AI"/"the assistant" |
| exfiltration | `exfiltration_url_template_in_image` | high | 带 `{{...}}`/`${...}` 模板的 markdown 图片 URL——数据外泄信标 |
| exfiltration | `reveal_system_prompt_request` | high | 要求模型透露其系统提示词的句子 |
| exfiltration | `reveal_system_prompt_tr` | high | 土耳其语形式："sistem istemini göster" |
| exfiltration | `send_data_to_url_instruction` | critical | 明确命令模型把数据发送到外部 URL 的指令 |

这些都是**启发式**发现——静态的文本模式扫描，而不是语义/意图分析。设计目标是低误报率（例如 emoji ZWJ 序列和普通的 `display:none` 弹窗已被专门排除），但每个发现仍应人工复核。

---

## 配置（`guardbee.yml`）

```yaml
prompt-injection-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - ".test.ts"
    - "fixtures/"
```

---

## 开发

```bash
npm run build
npm test             # 45 个单元测试
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
