# @guardbee/mcp-config-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 MCP 服务器，用于审计机器上的 MCP 客户端配置：Cursor `mcp.json`、Claude Desktop `claude_desktop_config.json`、Windsurf `mcp_config.json` 以及 VS Code `mcp.json`。

`mcp-server-auditor` 读取 MCP 服务器的源码。本包读取决定智能体将运行哪些服务器的配置。它不会启动那些服务器，也不会把配置发送到任何地方。

```
Claude ──► mcp-config-auditor ──► mcp.json  (or host-wide discover)
              │
              ├─ Unpinned package     (npx -y pkg, @latest)
              ├─ Typosquat            (one edit from a known server package)
              ├─ Secret in env/args
              ├─ autoApprove "*"
              ├─ Remote HTTP without auth
              ├─ Cross-server shadowing (when you pass a tool inventory)
              ├─ Agent SKILL.md (allowed-tools, body, lookalike names)
              └─ Shadow MCP discover  (OWASP MCP09 — host paths + org allowlist)
```

## 检查项

| 模式 | 严重级别 | OWASP | 含义 |
|---|---|---|---|
| `unpinned_package` | high | MCP04:2025 | 启动器（`npx`、`uvx`、`pnpm`、`yarn`、`bunx`、`pipx`）运行未固定 `major.minor.patch` 的包 |
| `typosquat_package` | critical | MCP04:2025 | 包名与已知 MCP 服务器包仅差一处编辑 |
| `secret_in_env` | critical | MCP01:2025 | 形似凭据的值，或带有较长字面量的敏感键 |
| `secret_in_args` | critical | MCP01:2025 | 命令行上的令牌 |
| `auto_approve_wildcard` | critical | MCP02:2025 | `autoApprove` / `alwaysAllow` 为 `*` 或 `true` |
| `cleartext_remote` | high | MCP07:2025 | 非 loopback 的 `http://` URL |
| `unauthenticated_remote` | high/medium | MCP07:2025 | 非 loopback URL，无 `Authorization` / API-key 头且无令牌环境变量 |
| `cross_server_tool_shadow` | high | MCP03:2025 | 两个服务器上有相同的工具名 |
| `confusable_tool_name` | critical | MCP03:2025 | 跨服务器的同形异义或仅差一处编辑的工具名 |
| `cross_server_tool_redirect` | high | MCP03:2025 | 描述告诉模型去调用另一服务器的工具 |
| `skill_unrestricted_shell` | critical | MCP02:2025 | `allowed-tools` 包含裸 `Bash`、`shell` 或 `*` |
| `skill_unrestricted_write` | high | MCP02:2025 | `allowed-tools` 包含无路径限制的 `Write` 或 `Edit` |
| `skill_instruction_override` | critical | MCP06:2025 | skill 告诉模型忽略先前指令 |
| `skill_covert_instruction` | critical | MCP06:2025 | skill 告诉模型向用户隐藏其行为 |
| `skill_secret_file_read` | critical | MCP01:2025 | skill 告诉模型读取 `.ssh`、`.env` 或类似文件 |
| `skill_at_secret_ref` | critical | MCP01:2025 | `@` 引用内联了凭据路径 |
| `secret_in_skill` | critical | MCP01:2025 | skill 文件中写入了字面量令牌 |
| `skill_name_shadow` | high | MCP03:2025 | 两个 `SKILL.md` 文件使用相同名称 |
| `skill_confusable_name` | critical | MCP03:2025 | 两个 skill 名仅差一个外形相似字符 |
| `shadow_mcp_server` | high | MCP09:2025 | `discover` — 主机上已安装但不在组织允许列表中的服务器 |
| `allowlist_not_configured` | medium | MCP09:2025 | 在无允许列表的情况下运行了 `discover` |
| `unreviewed_mcp_server` | low | MCP09:2025 | discover 期间看到的服务器尚无允许列表 |
| `mcp_server_drift_across_clients` | medium | MCP09:2025 | 同一服务器键在两个客户端中映射到不同的包/URL |

Loopback URL（`localhost`、`127.0.0.1`、`::1`）不算远程发现。占位值（`${API_KEY}`、`changeme`）不算密钥。报告的密钥匹配会被脱敏。`Bash(git diff:*)` 是命令允许列表，不算无限制 shell。单独的 `Read` 不会被标记。

## 快速开始

```json
{
  "mcpServers": {
    "guardbee-mcp-config-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-config-auditor"]
    }
  }
}
```

```bash
npx @guardbee/mcp-config-auditor scan .cursor/mcp.json --fail-on=high --format=sarif > results.sarif
npx @guardbee/mcp-config-auditor inventory ./tool-inventory.json
npx @guardbee/mcp-config-auditor discover --allowlist=./mcp-allowlist.json --fail-on=high
```

### Shadow MCP discover（MCP09）

遍历本机上已知的 Cursor / Claude Desktop / Claude Code / Windsurf / VS Code 路径，并将每个已安装服务器与组织允许列表比较。不会启动服务器。

允许列表 JSON：

```json
{
  "names": ["filesystem", "github"],
  "packages": ["@modelcontextprotocol/server-filesystem", "@guardbee/mcp-secret-scanner"],
  "hosts": ["mcp.example.com"]
}
```

或按行：`name:filesystem`、`package:@scope/pkg`、`host:mcp.example.com`，或裸服务器名。

目录扫描会打开 `mcp.json`、`mcp_config.json`、`claude_desktop_config.json` 与 `SKILL.md`。传入文件路径可扫描其他名称。名为 `SKILL.md` 的文件按智能体 skill 审计。同名与外形相似的 skill 发现出现在目录扫描中，因为单个文件看不到其他文件。

`guardbee.yml`：

```yaml
mcp-config-auditor:
  fail-on: high
  max-files: 5000
  exclude:
    - "fixtures/"
```

工具清单形状：

```json
{
  "servers": [
    { "name": "github", "tools": [{ "name": "create_issue", "description": "Open an issue" }] }
  ]
}
```

影子检测需要该清单，因为客户端配置不列出工具。`rug-pull-detector` 可以收集实时 `tools/list`；本包比较多份此类列表。
