# @guardbee/mcp-security-engineer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> 这是简短摘要。完整文档（英文）见 [README.md](README.md)。

用你的编码智能体（Claude Code、Cursor、VS Code）在自己的仓库中修复 **GuardBee AI Security Engineer** 的发现，然后在线上站点验证修复。GuardBee 负责发现并解释问题，并针对你的平台（Next.js、Express、Nginx、Apache、Cloudflare）给出修复建议；改动由你的智能体完成并由你批准，GuardBee 从不直接修改你的代码或服务器。需要具有 `remediations.read` 和 `remediations.write` 权限的 API 密钥（GuardBee → Developers → API keys）。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

## 安装

```bash
claude mcp add guardbee-security-engineer -e GUARDBEE_API_KEY=gb_... -- npx -y @guardbee/mcp-security-engineer
```

## MCP 工具

`list_assessments`, `get_assessment`, `detect_stack`, `get_fix`, `report_applied`, `verify_fix`

详细说明见 [README.md](README.md)。

## 许可证

MIT

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
