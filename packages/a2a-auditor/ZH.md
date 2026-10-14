# @guardbee/mcp-a2a-auditor

[![Listed on AgentHub](https://myagenthub.cn/badge/io.github.4hmetuyar/a2a-auditor)](https://myagenthub.cn/p/io.github.4hmetuyar/a2a-auditor)

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器，用于扫描智能体自身的 **Agent2Agent（A2A）协议实现**中的反模式——这些模式并非从规范文本臆造，而是直接来自参考 SDK（`@a2a-js/sdk`、`a2a-sdk`）及其官方示例代码。

A2A 目前还没有可引用的、类似 MCP 的「Security Considerations」章节。因此本包不做猜测，而是依据参考 SDK 源码中的三处事实：官方 push-notification 发送器会在不做任何主机校验的情况下拉取客户端提供的 webhook URL；官方*示例*智能体自带空的 security scheme 以及字面量 `noAuthentication` 请求处理器；Python SDK 的 `AgentCard(...)` 构造函数把两个 security 关键字参数完全视为可选——不传就静默等于「无认证」。

> 本包默认发送使用遥测（工具名 + 较短参数；绝不包含被扫描的代码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► a2a-auditor ──► Your A2A agent's source
              │
              ├─ webhook-ssrf            (push-notification webhook URL fetched with no allowlist)
              ├─ missing-authentication  (Agent Card / request handler requires no auth at all)
              └─ credential-exposure     (literal credential inside publicly-served Agent Card metadata)
```

---

## 为何特别关注这三项

**Webhook SSRF**：参考实现 `DefaultPushNotificationSender` 正是 `const url = pushConfig.url; ... fetch(url, ...)`——`pushConfig.url` 由订阅任务更新的客户端设置，而 SDK 拉取时不做任何主机校验。调用方可以把运行该代码的服务器指向内网服务、云元数据端点，或服务器网络可达的任何地址。

**缺少认证**：SDK 自带的示例智能体（`src/samples/agents/movie-agent`）使用 `securitySchemes: {}`、`securityRequirements: []` 以及 `userBuilder: UserBuilder.noAuthentication`——这种便于复制粘贴的形态看起来像占位符，功能上却是「接受任何人的任何请求」。Python SDK 通过「缺省」而非显式空值达到同样失败模式：`AgentCard(...)` 从不强制要求 `security_schemes`/`security_requirements`，因此按参考示例构建的真实智能体可能既无认证，也没有任何错误提示。

**凭据暴露**：Agent Card 是公开提供的——任何人只要能访问 `/.well-known/agent-card.json`（或等价发现响应）即可读取，*获取卡片本身*不需要认证。JSON 里的字面量 API 密钥实际上就是公开的。

---

## 功能

- **3 个类别**：webhook-ssrf、missing-authentication、credential-exposure
- **同时支持 TypeScript 与 Python A2A 代码**——两种 SDK 对同一失败使用不同惯用写法（空对象 vs. 缺省 kwargs），因此两种语言都会检查，而非只查一种
- 六项检查中有两项会跨若干行跟踪数据流，而不是只匹配单一调用点：webhook 检查会先把 `url` 变量追溯到形如 `pushConfig.url` 的赋值，再标记使用它的 `fetch()`；凭据检查会先用括号匹配提取完整 Agent Card 对象跨度，再在其中搜索字面量密钥——因此不会把文件里任意位置的 `apiKey:` 都标出来
- SARIF 2.1.0 输出——便于 CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 18 个单元测试——每个模式都有正向与负向（误报）场景，包括开发期间发现的真实 bug 回归（`\bAgentCard` 无法匹配 `movieAgentCard` 内部——小写与大写字母之间没有词边界——已改为按类名后缀匹配）。已用故意植入全部模式的 TypeScript 与 Python fixture 做端到端验证（全部命中），并对整个 guardbee-mcp monorepo（461 个文件）验证（真实代码零发现；唯一匹配来自本包测试 fixture、模式定义源码与 manifest 描述文本）

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-a2a-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-a2a-auditor"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-a2a-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP 工具

| 工具 | 说明 |
|------|----------|
| `scan_text` | 扫描代码片段 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描目录 |
| `list_patterns` | 按类别列出全部支持的模式 |

---

## 检测模式

| 类别 | 模式 | 严重级别 |
|---|---|---|
| webhook-ssrf | `webhook_url_direct_fetch_no_allowlist` | critical |
| webhook-ssrf | `webhook_url_indirect_fetch_no_allowlist` | critical |
| missing-authentication | `no_authentication_user_builder` | critical |
| missing-authentication | `empty_agent_card_security` | high |
| missing-authentication | `python_agent_card_no_auth` | high |
| credential-exposure | `agent_card_credential_in_metadata` | high |

---

## 配置（`guardbee.yml`）

```yaml
a2a-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## 限制（设计如此）

- **启发式，而非完整 A2A 一致性测试。** 本包查找来自参考 SDK 自身源码的特定反模式，而不是对运行中智能体做实时协议一致性检查。A2A 规范年轻且变化快——尚未覆盖的新失败模式会随时间出现。
- **数据流检查（间接 webhook fetch、Agent Card 凭据跨度）使用有界文本窗口与括号匹配**，而非真正的解析器——经更间接链路赋值的 `url` 变量（例如经辅助函数传递）不会被正确跟踪；拆成多次 `Object.assign()` 式合并而非单个字面量的 Agent Card 对象同样不会。
- **依赖命名约定。** 检查会寻找形如 `pushConfig.url`、`*AgentCard`、`UserBuilder.noAuthentication` 的标识符——若代码脱离 SDK 自身约定重命名，将无法识别；本系列基于模式的扫描器都有同样限制。

---

## 开发

```bash
npm run build
npm test             # 18 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
