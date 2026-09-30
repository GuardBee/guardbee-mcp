# @guardbee/mcp-prompt-leak-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器——同时也是一个独立的反向代理——在**发往** LLM 的 prompt 离开你的应用之前，发现其中泄露的凭据和 PII。

`secret-scanner` 查找躺在代码库里的密钥。本包查找的是进入了*运行时 prompt* 的密钥和 PII——客服智能体把客户工单（邮箱、银行卡号）直接贴进系统提示词，调试时有人把 API 密钥贴进聊天，内部工具把原始用户输入原封不动地转发给 LLM 而从不检查内容。这发生在流水线的另一个时刻，也是一种与泄露 `.env` 文件不同的失败模式。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含 prompt 内容和审计发现——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
你的应用 ──► prompt-leak-scanner（代理）──► 真实 LLM API（OpenAI/Anthropic/...）
                    │
                    ├─ monitor：原样转发，记录发现
                    ├─ redact： 转发前把匹配项替换为 [REDACTED:<id>]
                    └─ block：  在请求到达模型之前拒绝它
```

---

## 两种使用方式

**1. 按需扫描（MCP 工具）** —— `scan_text`/`scan_messages`/`scan_file`/`scan_directory`。在发布一个用用户输入构造 prompt 的功能之前，让 Claude 检查一个 prompt、一个聊天请求体样例，或一个 prompt 日志目录。

**2. 实时反向代理（`proxy` CLI 命令）** —— 位于你的应用和真实 LLM API 之间。它只缓冲并检查**发出的请求体**（消息/系统文本），然后把上游响应原样流式返回——因此 SSE/流式补全完全不受影响；只有*发出去*的 prompt 会被解析。把应用的 `baseURL` 指向代理而不是真实 API，集成的其他部分都无需改动。

```bash
guardbee-prompt-leak-scanner proxy --upstream=https://api.openai.com --port=8788 --mode=redact
# 你的应用：baseURL = http://localhost:8788，而不是 https://api.openai.com
```

---

## 检测质量：用校验和，而不只是正则

单纯匹配"11 位数字"或"16 位数字"的正则会不断误报订单号、电话分机号和时间戳。凡是有真实校验算法的 PII 模式都会使用它：

- **TC Kimlik No** —— 真实的 11 位土耳其身份证号校验算法（而不只是数位计数正则）
- **信用卡号** —— Luhn 校验
- **IBAN** —— ISO 7064 MOD97-10 校验

一个随机的 11 位数字碰巧通过 TC Kimlik 校验的概率大约是十分之一——单靠正则会嘈杂得多。凭据模式（API 密钥、JWT、私钥）按照各服务商真实的前缀/结构匹配（`sk-`、`AKIA`、`ghp_`、`-----BEGIN...PRIVATE KEY-----`、JWT 的三段 base64url 结构），与 `secret-scanner` 采用的低误报方法相同。校验算法来自 [`@guardbee/guard-core`](../guard-core/ZH.md)，与 `@guardbee/mcp-security-proxy` 共用。

**发现结果绝不回显真实值。** 发现中的 `maskedMatch` 只显示前 3 个和后 2 个字符（`sk-…wx`）——把刚抓到的东西记录或显示出来就失去了意义。代理的审计事件更进一步：只记录触发了哪个模式以及在哪里，从不记录匹配到的文本本身。

---

## 功能

- **13 个模式，4 个类别**：credential（9）、financial-pii（2，经校验和验证）、national-id（1，经校验和验证）、contact-pii（2）
- **理解聊天请求体** —— 能识别 OpenAI/Anthropic 风格的 `messages[].content`（字符串或内容块数组）和 `system` 字段，而不只是纯文本
- **实时反向代理模式**，支持 monitor/redact/block 策略——只检查请求，响应原样流式透传
- 发现结果已隐藏、审计事件不含凭据——工具本身绝不会成为泄露的第二份副本
- SARIF 2.1.0 输出 —— 便于 CI/CD 集成（GitHub Code Scanning 等）
- 支持通过 `guardbee.yml` 进行配置
- 29 个单元测试 —— 校验算法用已知正确/已知错误的测试向量验证；代理在全部三种模式下都通过真实的本地 HTTP 客户端/服务器往返测试（而不只是进程内 mock）

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-prompt-leak-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-prompt-leak-scanner"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-prompt-leak-scanner scan ./prompt-fixtures --fail-on=high --format=sarif > results.sarif
```

### CLI（实时代理）

```bash
npx @guardbee/mcp-prompt-leak-scanner proxy --upstream=https://api.openai.com --mode=block --fail-on-severity=critical
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描一段原始文本 |
| `scan_messages` | 扫描 OpenAI/Anthropic 风格的聊天请求体对象 |
| `scan_file` | 扫描单个文件（纯文本，或 JSON 请求体样例——自动识别） |
| `scan_directory` | 递归扫描 prompt 日志/样例目录 |
| `list_patterns` | 按类别列出所有支持的模式 |

---

## 检测的模式

| 类别 | 模式 | 严重度 |
|---|---|---|
| credential | OpenAI / Anthropic / Google / Stripe API 密钥、AWS access key ID、GitHub PAT、Slack token、PEM 私钥块 | critical |
| credential | JWT | high |
| financial-pii | 信用卡号（经 Luhn 验证） | high |
| financial-pii | IBAN（经 mod-97 验证） | high |
| national-id | TC Kimlik No（经校验和验证） | high |
| contact-pii | 电子邮件地址 | medium |
| contact-pii | 土耳其电话号码 | medium |

---

## 配置（`guardbee.yml`）

```yaml
prompt-leak-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - "fixtures/known-safe/"
```

---

## 限制（设计如此）

- 代理只检查**请求**体；不解析也不修改流式 SSE 响应——它们会被原样透传。
- 从聊天请求体中只提取 `messages[].content`（字符串或 `{type:"text"}` 内容块）和顶层的 `system`；不在这一结构内的服务商特有字段不会被扫描。
- 这是基于模式/校验和的检测，而不是通用的 NER/PII 模型——无法发现不符合已知结构模式的 PII（例如自由文本中的姓名或街道地址）。

---

## 开发

```bash
npm run build
npm test             # 29 个单元测试
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
