# @guardbee/mcp-toxic-flow-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP 服务器，用于审计 MCP **工具目录**中的**有毒数据流**——即 Simon Willison 所说的 *lethal trifecta*（致命三要素）：

1. **不可信内容**（fetch、scrape、browse、issue、feed）
2. **敏感 / 私有数据**（vault、数据库、密钥、受 KVKK 监管的 PII）
3. **外泄或破坏**（send、webhook、export、delete、drop）

当一个 MCP 服务器同时暴露这三者时，一次 prompt 注入就能把它们串联起来。主要对应 **OWASP MCP10:2025**。

> 本包默认发送使用遥测（工具名 + 较短的参数，绝不包含被扫描的代码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► toxic-flow-auditor ──► tools/list JSON 或 MCP 服务器源码
              │
              ├─ lethal_trifecta      (不可信 + 敏感 + 外发)
              ├─ single_tool_trifecta (单个工具就同时具备三者)
              ├─ sensitive_plus_exfil
              ├─ untrusted_plus_exfil
              └─ sensitive_plus_destruct
```

## 检测内容

- **目录层面的 lethal trifecta。** 同一服务器上有工具能抓取不可信内容、能访问 vault/数据库/PII，并且能把数据发出去或销毁数据。
- **单工具 trifecta。** 某一个工具注册本身的名称/描述就同时覆盖三种能力。
- **危险组合。** 即使完整的三要素不成立，也会报告 敏感+外泄、不可信+外泄 或 敏感+破坏 的组合。
- **考虑 KVKK 的启发式规则。** 土耳其语的 PII 信号（`tc_kimlik`、`müşteri`、`KVKK`）也算作敏感数据。
- **按词分析 snake_case 名称。** `read_vault_secret`、`drop_table` 这类名称会逐词识别；创建 pull request 算作外泄。

评级为 **A–F**。无需 API 密钥。仅做静态 / 目录分析——不会调用真实工具。

分类规则来自 [`@guardbee/guard-core`](../guard-core/ZH.md)，`@guardbee/mcp-security-proxy` 在运行时使用同一套规则拦截有毒数据流。

## 工具

| 工具 | 用途 |
|---|---|
| `audit_catalog` | 审计 `tools/list` 格式的 JSON 导出 |
| `scan_source` | 从源码文本中提取 `.tool(...)` 注册 |
| `scan_file` | 扫描单个源文件 |
| `scan_directory` | 递归扫描；合并各文件中的工具 |
| `explain_trifecta` | 解释该模型 |

## CLI

```
npx @guardbee/mcp-toxic-flow-auditor audit <tools.json> [--fail-on=any] [--format=text|json|sarif]
npx @guardbee/mcp-toxic-flow-auditor scan <path>        [--fail-on=any] [--format=text|json|sarif]
```

目录示例：

```json
{
  "tools": [
    { "name": "fetch_page", "description": "Scrape a URL" },
    { "name": "read_vault_secret", "description": "Read API key from vault" },
    { "name": "send_slack_message", "description": "Post to webhook" }
  ]
}
```
