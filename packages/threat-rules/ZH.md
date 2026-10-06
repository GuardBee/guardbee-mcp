# @guardbee/mcp-threat-rules

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | **🇨🇳 中文**

面向 **[Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules)** 的 GuardBee MCP 桥接层——针对 AI agent 威胁的开放、类 Sigma 检测标准（prompt 注入、工具投毒、上下文外泄、MCP 攻击）。

ATR 评估**运行时事件**。GuardBee 的其他包大多**扫描源码/目录**。本包把两者连起来：运行 ATR **以及 GuardBee 规则**（KVKK / 土耳其语注入 / 中文注入与身份证 / lethal-trifecta 意图），再跳转到对应的 GuardBee 审计器。

自定义项目规则：将 YAML 放到 `.guardbee/atr-rules/`，或设置 `GUARDBEE_ATR_RULES_DIR`。

> 默认开启使用遥测（工具名 + 较短参数，绝不包含被扫描内容——见 [`@guardbee/mcp-telemetry`](../telemetry/README.md)）。设置 `GUARDBEE_TELEMETRY=0` 可关闭。

```
Claude ──► threat-rules (ATR) ──► 匹配结果 + GuardBee 后续扫描提示
              │
              ├─ evaluate_text / evaluate_file / evaluate_event
              ├─ list_rules / rule_stats
              └─ explain_bridge
```

上游 ATR 为 MIT 许可，业界已广泛采用。我们依赖 `agent-threat-rules`，而不是 fork。

## 内置 GuardBee 规则（节选）

| ID | 说明 |
|---|---|
| `GB-ATR-2026-00001` | KVKK — TC Kimlik No |
| `GB-ATR-2026-00002` | 土耳其语 prompt 注入 |
| `GB-ATR-2026-00003` | Lethal trifecta 意图 |
| `GB-ATR-2026-00004` | 中文 prompt 注入（简/繁） |
| `GB-ATR-2026-00005` | 中国居民身份证号 |

## 工具

| 工具 | 用途 |
|---|---|
| `evaluate_text` | 用 ATR + GuardBee 规则给自由文本打分 |
| `evaluate_file` | 扫描本地文件 |
| `evaluate_event` | 评估结构化 ATR `AgentEvent` JSON |
| `list_rules` | 列出已加载规则（`source=atr\|guardbee`） |
| `rule_stats` | 按类别/来源统计 |
| `explain_bridge` | 说明 ATR 如何映射到 GuardBee 扫描器 |

## CLI

```
npx @guardbee/mcp-threat-rules eval "…" --format=json --fail-on=high
npx @guardbee/mcp-threat-rules scan ./prompt.txt --format=sarif
npx @guardbee/mcp-threat-rules list --source=guardbee
npx @guardbee/mcp-threat-rules stats
```

## 相关 GuardBee 包

| ATR 类别 | GuardBee 后续 |
|---|---|
| prompt-injection | `@guardbee/mcp-prompt-injection-scanner` |
| tool-poisoning | `@guardbee/mcp-tool-poisoning-scanner` |
| context-exfiltration | `@guardbee/mcp-toxic-flow-auditor`、`@guardbee/mcp-prompt-leak-scanner` |
| privilege-escalation | `@guardbee/mcp-oauth-auditor`、`@guardbee/mcp-server-auditor` |
