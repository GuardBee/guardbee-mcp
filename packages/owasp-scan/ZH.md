# @guardbee/mcp-owasp-scan

**🇬🇧 [English](README.md)** | [🇹🇷 Türkçe](TR.md) | 🇨🇳 中文

统一的 **OWASP MCP Top 10** 扫描：路径模式编排 GuardBee 各审计器；`live` / `catalog` 对 `tools/list` 做 toxic-flow + 工具投毒评分（A–F）。

```bash
npx @guardbee/mcp-owasp-scan scan ./src --format=sarif --fail-on=high
```
