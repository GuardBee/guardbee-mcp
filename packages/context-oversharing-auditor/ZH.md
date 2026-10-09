# @guardbee/mcp-context-oversharing-auditor

**🇬🇧 [English](README.md)** | [🇹🇷 Türkçe](TR.md) | 🇨🇳 中文

针对 **OWASP MCP10:2025 上下文过度共享** 的静态审计。`toxic-flow-auditor` 评估工具目录上的致命三元组；本包检查会话/记忆/系统提示是否向当前主体泄露过多上下文。

```bash
npx @guardbee/mcp-context-oversharing-auditor scan ./src --format=sarif
```
