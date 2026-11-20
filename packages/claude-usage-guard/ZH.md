# @guardbee/mcp-claude-usage-guard

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 这是简短摘要。完整文档（英文）见 [README.md](README.md)。

检查你的 Claude 套餐用量是否都来自你自己。将 Claude Code 为 /usage 缓存的账户级套餐计量（5 小时 / 7 天）与本机的会话记录随时间对比，标记本地无法解释的用量。此外还检查账户切换、使用你登录凭据的 SDK/脚本、远程登录和后台会话。注意：你自己在 claude.ai、桌面端和手机端的聊天也计入同一额度。

## 安装

```bash
claude mcp add claude-usage-guard -- npx -y @guardbee/mcp-claude-usage-guard
```

## MCP 工具

`detect_foreign_usage`, `usage_report`, `account_status`, `plan_forecast`, `install_hooks`, `uninstall_hooks`

新增：安装钩子后，一旦出现本机无法解释的用量，会立即发出警报（加 `--notify` 还会弹出桌面通知）。

各工具的详细说明见 [README.md](README.md)。

## CLI

```bash
npx @guardbee/mcp-claude-usage-guard detect
```

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
