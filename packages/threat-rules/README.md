# @guardbee/mcp-threat-rules

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md)

GuardBee MCP bridge to **[Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules)** — the open, Sigma-like detection standard for AI agent threats (prompt injection, tool poisoning, context exfiltration, MCP attacks).

ATR evaluates **runtime events**. GuardBee’s other packages mostly **scan source/catalogs**. This package connects both: run ATR **plus GuardBee rules** (KVKK / Turkish & Chinese injection / Chinese ID / lethal-trifecta intent), then jump to the matching GuardBee auditor.

Custom project rules: drop YAML into `.guardbee/atr-rules/` or set `GUARDBEE_ATR_RULES_DIR`.

> Telemetry on by default (tool name + short params; scanned content never leaves — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► threat-rules (ATR) ──► matches + GuardBee follow-up hints
              │
              ├─ evaluate_text / evaluate_file / evaluate_event
              ├─ list_rules / rule_stats
              └─ explain_bridge
```

Built-in GuardBee rules include KVKK TC Kimlik, Turkish & Chinese injection, Chinese national ID, and lethal-trifecta intent (`GB-ATR-2026-00001` … `00005`).

Upstream ATR is MIT-licensed and already used across the industry. We depend on `agent-threat-rules` rather than forking it.

## Tools

| Tool | Purpose |
|---|---|
| `evaluate_text` | Score free text against ATR + GuardBee rules |
| `evaluate_file` | Score a local file |
| `evaluate_event` | Score a structured ATR `AgentEvent` JSON |
| `list_rules` | List loaded rules (`source=atr\|guardbee`) |
| `rule_stats` | Counts by category/source |
| `explain_bridge` | How ATR maps onto GuardBee scanners |

## CLI

```
npx @guardbee/mcp-threat-rules eval "…" --format=json --fail-on=high
npx @guardbee/mcp-threat-rules scan ./prompt.txt --format=sarif
npx @guardbee/mcp-threat-rules list --source=guardbee
npx @guardbee/mcp-threat-rules stats
```

## Related GuardBee packages

| ATR category | GuardBee follow-up |
|---|---|
| prompt-injection | `@guardbee/mcp-prompt-injection-scanner` |
| tool-poisoning | `@guardbee/mcp-tool-poisoning-scanner` |
| context-exfiltration | `@guardbee/mcp-toxic-flow-auditor`, `@guardbee/mcp-prompt-leak-scanner` |
| privilege-escalation | `@guardbee/mcp-oauth-auditor`, `@guardbee/mcp-server-auditor` |
