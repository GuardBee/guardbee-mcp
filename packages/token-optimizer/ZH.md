# @guardbee/mcp-token-optimizer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 这是简短摘要。完整文档（英文）见 [README.md](README.md)。

找出本机消耗 Claude Code token 的源头并停止：过大的上下文（每条消息都会重新发送整个上下文）、塞满上下文的文件读取和 MCP 工具、未使用的 MCP 服务器以及空闲会话。

## 安装

```bash
claude mcp add token-optimizer -- npx -y @guardbee/mcp-token-optimizer
```

## MCP 工具

`optimize_report`, `list_sessions`, `stop_sessions`, `audit_mcp_servers`, `disable_mcp_servers`, `restore_mcp_servers`

各工具的详细说明见 [README.md](README.md)。

`stop_sessions`、`disable_mcp_servers` 和 `restore_mcp_servers` 默认仅演练。只会停止 Claude Code CLI，绝不会停止正在运行该工具的会话（可用 `claude --resume` 恢复）；每次修改配置前都会先备份。

## CLI

```bash
npx @guardbee/mcp-token-optimizer report
```

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
