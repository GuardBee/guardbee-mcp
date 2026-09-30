# @guardbee/mcp-security-proxy

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

一个透明的安全层，放在任何 MCP 服务器前面。它拦截 prompt 注入攻击，对响应中的 PII 进行脱敏，并把每个请求写入不可篡改的审计日志。

> 本包默认向 GuardBee 发送使用遥测（工具名 + 较短的参数，见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)），这与它自己的本地审计日志相互独立。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► MCP Security Proxy ──► 任意 MCP 服务器
                │
                ├─ Prompt 注入检测        (27 条规则，英文 + 土耳其语)
                ├─ PII + 密钥脱敏         (TC、VKN、IBAN、银行卡、电话、22 种密钥格式)
                ├─ 拦截或警告模式
                ├─ 有毒数据流（lethal trifecta）拦截
                └─ 哈希链审计日志
```

---

## 功能

- **Prompt 注入防护** —— 27 条英文和土耳其语规则；精确规则会拦截，通用短语只发出警告
- **工具结果注入** —— 同一套规则也作用于工具结果，标记为 MCP06:2025。拦截模式会替换结果；警告模式会在结果前加上一条警告
- **会话工具固定（pin）** —— 固定第一次 `tools/list` 的结果。之后描述或 schema 的变化即视为 rug pull（MCP03:2025）。拦截模式继续提供固定的定义，并拒绝已漂移的调用
- **PII 脱敏** —— 对响应中的土耳其身份证号（TC Kimlik No）、税号（VKN）、IBAN、银行卡号和电话号码（均经校验和验证）、电子邮件、22 种服务商密钥格式、私钥和数据库连接串进行脱敏
- **拦截 / 警告模式** —— 每个拦截器都可以独立运行在拦截或警告模式
- **审计日志** —— 可配置，写入控制台或文件
- **网关模式** —— 多个 MCP 服务器置于同一个代理之后，使用一份 YAML 策略（allow / deny / mask / warn）
- **有毒数据流拦截** —— 跨服务器追踪 lethal trifecta，并拦截会使其成立的外发（egress）调用
- **无需改代码** —— 直接挂在任何现有 MCP 服务器前面

---

## 快速开始

```bash
npm install -g @guardbee/mcp-security-proxy
```

添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "secure-filesystem": {
      "command": "npx",
      "args": [
        "-y", "@guardbee/mcp-security-proxy",
        "--", "npx", "-y",
        "@modelcontextprotocol/server-filesystem", "/tmp"
      ]
    }
  }
}
```

> 代理会把 `--` 之后的内容作为目标 MCP 服务器启动。

---

## 网关模式：多个服务器，一份策略

用一个 `guardbee-proxy.yaml` 把所有 MCP 服务器放到同一个代理后面。`init` 可以帮你完成迁移：

```bash
npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop   # 或 cursor、claude-code、--file ./mcp.json
```

它会把每个 stdio 服务器移入 `~/.guardbee/guardbee-proxy.yaml`（权限 0600），备份客户端配置，并把配置指向代理。HTTP 服务器保持不变并会被报告出来，因为它们会绕过策略。`--dry-run` 只打印两个文件而不写入。也可以手动配置：

```json
{
  "mcpServers": {
    "guardbee": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-security-proxy@^1", "--config", "/path/to/guardbee-proxy.yaml"]
    }
  }
}
```

```yaml
version: 1
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }   # 从环境变量读取
  postgres:
    command: npx
    args: ["-y", "@guardbee/mcp-db-gateway"]

labels:                       # 覆盖启发式标签
  github__get_issue: [untrusted]
  github__create_pull_request: [egress]

rules:                        # 第一条匹配的规则生效
  - id: no-deletes
    match: { tool: "postgres__delete_*" }
    action: deny              # allow | deny | mask | warn | approve
  - match: { tool: "postgres__query", args: { table: "salaries" } }   # 点分路径 → 值，字符串为 glob
    action: mask
    mask: { fields: [salary, iban] }   # 清空这些 JSON 键
  - match: { label: destructive }
    action: approve           # 先征求用户同意

taint:
  mode: strict                # strict | approve | warn | off

audit:
  sink: file
  filePath: ./guardbee-audit.jsonl
```

- 工具和 prompt 以 `<upstream>__<tool>` 的名称出现。
- **有毒数据流（lethal trifecta）：** 每个工具会被标记为 `untrusted`、`sensitive`、`egress` 或 `destructive`（基于名称/描述的启发式，可在 `labels` 中覆盖）。当一个会话既读取过不可信内容（`untrusted` 工具或任何 resource），又读取过敏感数据（`sensitive` 工具，或结果中出现任何 PII）之后，`egress` 调用在 `strict` 模式下会被拦截，在 `warn` 模式下只记录日志。该检查跨服务器生效：从 GitHub 读取的 issue 加上从 CRM 读取的客户记录，会拦截第三个服务器上的 webhook 调用。
- **规则**可按 `tool`（glob）、`upstream`、`label`、`session`（`clean` | `tainted`）和 `args` 匹配。即使全局脱敏关闭，`mask` 也会对该工具强制进行 PII 脱敏；`mask.fields` 还会清空文本和 `structuredContent` 中指定的 JSON 键。规则中的 `allow` 不会跳过有毒数据流检查；如需放行，请修改该工具的标签。
- **审批：** `approve`（规则动作，或针对有毒数据流的 `taint.mode: approve`）会通过 MCP elicitation 向用户展示一个是/否表单，其中包含工具、原因和参数。除明确的"是"之外的任何回答——拒绝、取消、在 `approval.timeoutSeconds`（默认 120 秒）内未作答——都会拦截该调用。不支持 elicitation 的客户端无法审批，调用会被拦截并附带说明。
- **令牌化（Tokenize）：** 设置 `interceptors.piiMasking.mode: tokenize` 后，模型看到的是 `<pii:tc_kimlik:7f3a9b21>` 而不是真实值，并且仍然可以把它传给另一个工具：代理会在发往该服务器时把真实值放回去。令牌只在会话期间保存在内存中；除非设置 `piiMasking.detokenizeForEgress: true`，否则不会为 `egress` 工具还原成真实值。
- **Prompt**（`prompts/get`）与工具结果一样，经过注入扫描和 PII 脱敏。
- `interceptors.definitionDrift.recheck: on-change` 会跳过每次调用前的 `tools/list`，只在服务器发送 `tools/list_changed` 后重新检查；代理也会把该通知转发给智能体。
- **审计日志**采用哈希链。默认只保存参数的 SHA-256，而不保存参数本身，也不保存结果；设置 `audit.includePayloads: true` 可记录它们。用 `guardbee-proxy verify-audit ./guardbee-audit.jsonl` 校验日志。
- `guardbee-proxy validate --config guardbee-proxy.yaml` 在不启动任何服务器的情况下检查配置。
- 未指定 `--config` 时，代理也会读取 `./guardbee-proxy.yaml` 或 `GUARDBEE_PROXY_CONFIG=<file>.yaml`。

上面的单服务器 `--` 用法保持 0.x 的行为：工具名不加前缀，记录完整载荷，有毒数据流只记为警告。

---

## 远程模式（HTTP）

代理也可以作为共享的网络服务运行，而不只是某个客户端的子进程。智能体通过 Streamable HTTP 连接；上游也可以是远程的 Streamable HTTP 服务器。

```yaml
version: 1
listen:
  transport: http              # stdio (default) | http
  host: 0.0.0.0                # 容器中用 0.0.0.0；笔记本上用 127.0.0.1
  port: 8787
  path: /mcp
  apiKeys: ["${GUARDBEE_PROXY_KEY}"]   # 智能体发送 Authorization: Bearer <key>
  maxSessions: 100
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  linear:
    url: https://mcp.linear.app/mcp     # 一个 Streamable HTTP 上游
    headers: { Authorization: "Bearer ${LINEAR_TOKEN}" }
audit:
  sink: file
  filePath: /var/log/guardbee/audit.jsonl
  dashboard:
    url: https://app.guardbee.ai/api/v1/gateway/events
    apiKeyEnv: GUARDBEE_API_KEY        # 带 gateway.write 权限的工作区 API 密钥
```

- **会话相互隔离。** 每个 MCP 会话都有自己的污点状态、PII 令牌和工具固定；一个智能体的有毒数据流绝不会拦截另一个智能体。所有会话共享上游连接。审计事件带有 `sessionId`。
- **没有密钥就不能监听网络。** 未配置 `listen.apiKeys` 就在回环地址以外监听属于配置错误。密钥以恒定时间比较；错误或缺失的密钥返回 `401`。
- `GET /healthz` 返回 `{"ok": true, "sessions": N}`。超过 `maxSessions` 的会话返回 `503`。
- **仪表盘：** `audit.dashboard` 会用从 `apiKeyEnv` 读取的工作区 API 密钥，把每个审计事件批量发送到 GuardBee 仪表盘；密钥不写在文件中。仪表盘不可达时，事件会在内存中等待（最多 10,000 条）并稍后发送。被拒绝的密钥只会在 stderr 报告一次。工具调用从不等待仪表盘。
- `init` 现在也会把 Streamable HTTP 服务器（`url` + `headers`）移到代理之后。旧的 SSE 服务器保留在客户端配置中并会被报告。

Docker：

```bash
docker build -t guardbee/mcp-security-proxy packages/security-proxy
docker run -p 8787:8787 -e GUARDBEE_PROXY_KEY=... -e GUARDBEE_API_KEY=... \
  -v "$PWD/guardbee-proxy.yaml:/etc/guardbee/guardbee-proxy.yaml:ro" guardbee/mcp-security-proxy
```

---

## MCP 工具

代理本身不注册任何工具。它转发目标服务器的工具，并在每次调用时应用拦截器链。

---

## 拦截器

### Prompt 注入检测

来自 [`@guardbee/guard-core`](../guard-core/README.md) 的 27 条规则，作用于工具参数、工具结果、resource 和 prompt：

- **拦截**（13 条精确规则，high/critical）：英文和土耳其语的指令覆盖（"ignore all previous instructions"、"önceki talimatları yok say"）、`DAN mode`、"bypass your safety guardrails"、聊天模板标记（`<|im_start|>`、`[INST]`）、`<system>` 标签、藏在 Unicode tag 字符中的文本、CSS 隐藏元素或 HTML 注释中的指令、markdown 图片外泄信标、索要系统提示词的请求（英文和土耳其语）、"send the user's data to https://…"。
- **仅警告**（14 条）：在普通文本中也会出现的通用短语——"act as"、"you are now"、"developer mode"、"jailbreak"、"override policy"、"sen artık"——以及中等严重度的信号，如零宽字符或双向（bidi）控制字符、行首的 `System:` 标签。
- **Base64：** 能解码为可读文本的片段会被解码，并用拦截规则检查，因此指令无法藏在编码的数据块里。

从 1.1 开始，单独出现的通用短语不再触发拦截：在 1.0 中，工具结果里的 "use jailbreak mode" 或 "act as a reverse proxy" 会被拦截；现在只记录日志，并在结果中附上一条警告。

### PII 脱敏

| 数据类型 | 校验 | 输入示例 | 输出 |
|-----------|-------|---------------|--------|
| 土耳其身份证号（TC Kimlik No） | 官方校验算法 | `10000000146` | `[TC-KİMLİK]` |
| IBAN（TR） | mod-97 | `TR330006100519786457841326` | `TR**[IBAN]` |
| 银行卡号 | Luhn | `4111 1111 1111 1111` | `****-****-****-[KART]` |
| 电子邮件 | — | `ahmet@example.com` | `***@[EMAIL]` |
| 电话（土耳其） | 手机 / 座机 / 850 前缀 | `0532 123 45 67` | `+90-***-***-**[TELEFON]` |
| 税号（VKN） | 校验位，且需带 `VKN` / `Vergi No` 标签 | `VKN: 1234567890` | `VKN: [VKN]` |
| 服务商密钥 | 来自 secret-scanner 的 22 种密钥和令牌格式（AWS、GitHub、Stripe、OpenAI、Anthropic、Slack 等） | `ghp_…`、`AKIA…` | `[API-KEY]` |
| 其他 API 密钥 | `sk_`/`api_`/`token_` 等前缀，同时含字母和数字 | `api_k3y9x8…` | `[API-KEY]` |
| 私钥 | 完整的 BEGIN…END 块 | `-----BEGIN … PRIVATE KEY-----` | `[PRIVATE-KEY]` |
| 数据库连接串 | URL 中的 用户名:密码（排除 localhost） | `postgres://app:pw@db/prod` | `[CONNECTION-STRING]` |
| JWT | — | `eyJhbGc...` | `[JWT-TOKEN]` |

未通过校验和的数字（订单号、快递单号）保持原样。

---

## 配置

可通过环境变量配置：

| 变量 | 默认值 | 说明 |
|----------|-----------|----------|
| `PROXY_MODE` | `block` | `block` 或 `warn` |
| `PROXY_LOG` | `console` | `console` 或 `file` |
| `PROXY_LOG_PATH` | `./proxy-audit.jsonl` | 日志文件路径 |
| `PROXY_PII_MASK` | `true` | 启用 PII 脱敏 |
| `PROXY_INJECTION_CHECK` | `true` | 启用注入检查 |

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
