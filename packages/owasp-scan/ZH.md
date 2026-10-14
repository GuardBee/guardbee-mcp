# @guardbee/mcp-owasp-scan

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

一个 CLI / MCP，用于做**统一的 [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) 体检**——这是 GuardBee 对那些只做实时连接、一键扫描的竞品的回应。

| 模式 | 作用 |
|---|---|
| `scan <path>` | 编排 secret、server、oauth、audit-gap、context-oversharing、toxic-flow、tool-poisoning |
| `live` | 连接（stdio/HTTP），调用 `tools/list`，再跑 toxic-flow + tool-poisoning |
| `catalog` | 与 live 相同，但输入为 JSON 导出 |

可选的 `--discover-shadow` 会通过 `mcp-config-auditor` 增加 **MCP09** 主机发现。

> 默认开启遥测（工具名 + 较短参数；绝不发送被扫描的代码）。设置 `GUARDBEE_TELEMETRY=0` 即可关闭。

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
