# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 这是简短摘要。完整文档（英文）见 [README.md](README.md)。

一次安装即可获得全部 GuardBee MCP 安全工具：一个 MCP 服务器提供你所选包的工具，CLI 可运行任意包。共 29 个包、124 个 MCP 工具。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

## 安装

```bash
npm install -g @guardbee/security-suite
```

## MCP 工具

`guardbee serve` 默认提供**推荐**组（31 个工具）：一次性 OWASP MCP Top 10 扫描、密钥、提示注入、有害数据流、MCP 客户端配置和依赖 CVE。用 `--tools=code,network` 选择组或包 ID，或用 `--tools=all`（124 个工具）。工具名带有包前缀，例如 `secrets_scan_text`、`injection_scan_text`。`guardbee list` 列出所有包和组。

```json
{ "mcpServers": { "guardbee": { "command": "npx", "args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended"] } } }
```

## CLI

`guardbee <包 ID> <参数>` 运行该包自己的 CLI，例如 `guardbee owasp-scan scan . --fail-on=high`。

## 许可证

MIT — [GuardBee](https://guardbee.ai)

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
