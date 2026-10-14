# @guardbee/mcp-server-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 MCP（Model Context Protocol）服务器，用于扫描**其他 MCP 服务器**的工具定义中的不安全模式。

`ai-code-scanner` 查看一般的 LLM/AI 集成代码，而本包专门查看 MCP 服务器本身：经 `server.tool(...)` 定义的工具权限有多高、参数有多宽松、其处理函数把工具输入直接传入哪些危险 sink（shell/文件系统/HTTP/SQL）。MCP 生态增长很快，但还没有用于审计这些服务器安全性的通用工具。

> 本包默认发送使用遥测（工具名 + 较短参数；绝不包含被扫描的代码——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

```
Claude ──► mcp-server-auditor ──► An MCP server's source code
              │
              ├─ Excessive agency    (execSync(input.command), a tool named "run_shell")
              ├─ Unsafe input        (fetch(input.url) → SSRF, SQL string interpolation)
              ├─ Loose schema        (a parameter typed z.any()/z.unknown())
              ├─ Secrets exposure    (a hardcoded API key in a schema default, the entire process.env)
              └─ Network exposure    (wildcard CORS)
```

---

## 功能

- **10 个模式，5 个类别** — excessive-agency、unsafe-input、loose-schema、secrets-exposure、network-exposure
- 每条发现都包含**为何有风险以及如何处理**（`recommendation`）——不只是「找到了」
- SARIF 2.1.0 输出——便于 CI/CD 集成（GitHub Code Scanning 等）
- 通过 `guardbee.yml` 支持配置文件
- 32 个单元测试——每个模式都有正向与负向（误报）场景

---

## 快速开始

### Claude Desktop / MCP 客户端

```json
{
  "mcpServers": {
    "guardbee-mcp-server-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-server-auditor"]
    }
  }
}
```

### CLI（CI/CD）

```bash
npx @guardbee/mcp-server-auditor scan ./src --fail-on=high --format=sarif > results.sarif
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

| 类别 | 模式 | 严重级别 | OWASP | 含义 |
|---|---|---|---|---|
| excessive-agency | `shell_exec_from_tool_input` | critical | MCP05:2025 | 工具处理函数把工具输入直接传入 `execSync`/`spawn` 等 shell 调用 |
| excessive-agency | `eval_of_tool_input` | critical | MCP05:2025 | 工具输入经 `eval()`/`new Function()` 当作代码执行 |
| excessive-agency | `unrestricted_shell_tool_name` | high | MCP05:2025 | 工具名（`run_shell`、`execute_sql` 等）直接暗示 shell/SQL 执行 |
| unsafe-input | `fs_write_from_raw_tool_input` | high | | 来自工具输入的路径在无校验情况下流入文件写入/删除调用（路径遍历） |
| unsafe-input | `ssrf_fetch_from_tool_input` | high | | 来自工具输入的 URL 在无允许列表情况下直接流入 `fetch`/`axios`（SSRF） |
| unsafe-input | `sql_injection_via_tool_input` | critical | MCP05:2025 | 工具输入经模板字符串插入 SQL 字符串 |
| loose-schema | `overly_permissive_tool_schema` | medium | | 工具参数类型为 `z.any()`/`z.unknown()`——接受任意值 |
| secrets-exposure | `hardcoded_secret_in_tool_schema` | critical | | 形似凭据的 schema 字段默认值是硬编码字面量 |
| secrets-exposure | `full_env_exposed_to_tool_caller` | critical | | 整个 `process.env` 被展开/序列化/返回（而非单个命名变量） |
| network-exposure | `permissive_cors_on_server` | medium | | 通配 CORS（`Access-Control-Allow-Origin: *`）或无选项的 `cors()` |

这些是**启发式**发现——静态文本模式扫描，而非完整 AST/类型分析。设计目标是低误报率，但每条发现仍应人工复核。

---

## 配置（`guardbee.yml`）

```yaml
mcp-server-auditor:
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
npm test             # 32 unit tests
```

---

## 许可证

MIT — [GuardBee](https://guardbee.ai)
