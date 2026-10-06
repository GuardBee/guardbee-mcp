# @guardbee/mcp-threat-rules

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

GuardBee MCP bridge to **[Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules)** — the open, Sigma-like detection standard for AI agent threats (prompt injection, tool poisoning, context exfiltration, MCP attacks).

ATR evaluates **runtime events**. GuardBee’s other packages mostly **scan source/catalogs**. This package connects both: run ATR, then jump to the matching GuardBee auditor.

> Telemetry on by default (tool name + short params; scanned content never leaves — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► threat-rules (ATR) ──► matches + GuardBee follow-up hints
              │
              ├─ evaluate_text / evaluate_event
              ├─ list_rules
              └─ explain_bridge
```

Upstream ATR is MIT-licensed and already used across the industry. We depend on `agent-threat-rules` rather than forking it.

## Tools

| Tool | Purpose |
|---|---|
| `evaluate_text` | Score free text against ATR |
| `evaluate_event` | Score a structured ATR `AgentEvent` JSON |
| `list_rules` | List loaded ATR rules |
| `explain_bridge` | How ATR maps onto GuardBee scanners |

## CLI

```
npx @guardbee/mcp-threat-rules eval "Ignore previous instructions…"
npx @guardbee/mcp-threat-rules list --category=tool-poisoning
```

## Related GuardBee packages

| ATR category | GuardBee follow-up |
|---|---|
| prompt-injection | `@guardbee/mcp-prompt-injection-scanner` |
| tool-poisoning | `@guardbee/mcp-tool-poisoning-scanner` |
| context-exfiltration | `@guardbee/mcp-toxic-flow-auditor`, `@guardbee/mcp-prompt-leak-scanner` |
| privilege-escalation | `@guardbee/mcp-oauth-auditor`, `@guardbee/mcp-server-auditor` |
