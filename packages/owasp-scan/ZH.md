# @guardbee/mcp-owasp-scan

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文** | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

一个 CLI / MCP，用于做**统一的 [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) 体检**——这是 GuardBee 对那些只做实时连接、一键扫描的竞品的回应。

| 模式 | 作用 |
|---|---|
| `scan <path>` | 编排 secret、server、oauth、audit-gap、context-oversharing、toxic-flow、tool-poisoning |
| `live` | 连接（stdio/HTTP），调用 `tools/list`，再跑 toxic-flow + tool-poisoning |
| `catalog` | 与 live 相同，但输入为 JSON 导出 |

可选的 `--discover-shadow` 会通过 `mcp-config-auditor` 增加 **MCP09** 主机发现。

> 遥测默认**关闭**。设置 `GUARDBEE_TELEMETRY=1` 后会发送服务器、工具、成功与否、耗时以及文件路径等简短参数值；更长的字符串和 `content`、`token`、`password` 等字段会被占位符替换。参见 [`@guardbee/mcp-telemetry`](../telemetry/ZH.md)。

## 快速开始

```bash
npx @guardbee/mcp-owasp-scan scan ./src --format=sarif --fail-on=high
npx @guardbee/mcp-owasp-scan live --url=https://mcp.example.com/mcp
npx @guardbee/mcp-owasp-scan catalog ./tools.json --format=json
```

```json
{
  "mcpServers": {
    "guardbee-owasp-scan": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-owasp-scan"]
    }
  }
}
```

## 覆盖范围说明

- **MCP04**（供应链）和 **MCP06**（RAG prompt 注入）仍在各自的专用包中（`dependency-auditor` / `slopsquat-scanner`、`prompt-injection-scanner`）——它们需要网络或内容语料，本元扫描默认不会拉取。
- **A–F** 评级遵循 toxic-flow 语义（lethal trifecta → F）。

## 反馈

有问题、想法或误报？请在 [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) 发帖或[提交 issue](https://github.com/GuardBee/guardbee-mcp/issues)。如果 GuardBee 对你有帮助，给[仓库](https://github.com/GuardBee/guardbee-mcp)点个 ⭐ 能让更多人发现它。
