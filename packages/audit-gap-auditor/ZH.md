# @guardbee/mcp-audit-gap-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP 服务器，用于审计 MCP 服务器源码中的 **OWASP MCP08:2025 — Lack of Audit and Telemetry**（缺少审计与遥测）缺口。

`security-proxy` 已在网关侧写入哈希链审计日志。本包问的是另一个问题：工具运行时，MCP *服务器本身* 是否留下可用、且不泄露敏感信息的轨迹？

> 本包默认发送使用遥测（工具名 + 较短参数；绝不包含被扫描的代码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► audit-gap-auditor ──► MCP 服务器源码
              │
              ├─ missing-telemetry （已注册工具，但无调用审计/日志/遥测）
              ├─ unsafe-logging     （日志写入原始工具参数或结果）
              ├─ disabled-audit     （源码中硬编码关闭审计/遥测）
              └─ silent-failure     （工具错误被空 catch 吞掉）
```

## 检测内容

| 模式 | 严重级别 | OWASP | 含义 |
|---|---|---|---|
| `mcp_server_without_tool_audit` | high | MCP08:2025 | `McpServer` / FastMCP 注册了工具，但文件中从未出现 audit/telemetry |
| `raw_tool_args_logged` | critical | MCP08:2025 | `console`/`logger` 完整记录 `args`/`params`/`input` 对象 |
| `raw_tool_result_logged` | high | MCP08:2025 | 完整记录 `result` / `toolResult` |
| `audit_disabled_in_code` | high | MCP08:2025 | `audit: false`、`enableAudit: false`、`GUARDBEE_TELEMETRY=0` 等 |
| `tool_error_swallowed_silently` | medium | MCP08:2025 | 工具处理函数附近空的 / 仅 return 的 `catch` |
| `audit_log_without_correlation_id` | medium | MCP08:2025 | `audit.log({…})` 中没有 `sessionId` / `requestId` 等 |

日志相关检查仅在看起来像 MCP 工具服务器的文件中运行，因此其他位置的普通 `console.log(args)` 辅助函数会被忽略。

## 快速开始

```json
{
  "mcpServers": {
    "guardbee-audit-gap-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-audit-gap-auditor"]
    }
  }
}
```

```bash
npx @guardbee/mcp-audit-gap-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

## 工具

| 工具 | 用途 |
|---|---|
| `scan_text` | 扫描源码字符串 |
| `scan_file` | 扫描单个文件 |
| `scan_directory` | 递归扫描 |
| `list_patterns` | 列出 MCP08 检查项 |

`guardbee.yml`：

```yaml
audit-gap-auditor:
  fail-on: high
  max-files: 5000
  exclude:
    - "fixtures/"
```
