# @guardbee/mcp-threat-rules

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-threat-rules.svg)](https://www.npmjs.com/package/@guardbee/mcp-threat-rules)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-threat-rules.svg)](https://www.npmjs.com/package/@guardbee/mcp-threat-rules)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/threat-rules/LICENSE)

GuardBee MCP bridge to **[Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules)** — the open, Sigma-like detection standard for AI agent threats (prompt injection, tool poisoning, context exfiltration, MCP attacks).

ATR evaluates **runtime events**. GuardBee’s other packages mostly **scan source/catalogs**. This package connects both: run ATR **plus GuardBee rules** (KVKK / Turkish & Chinese injection / Chinese ID / lethal-trifecta intent), then jump to the matching GuardBee auditor.

Custom project rules: drop YAML into `.guardbee/atr-rules/` or set `GUARDBEE_ATR_RULES_DIR`.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

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
| `framework_map` | How GuardBee runtime findings map to OWASP LLM Top 10 (2025) and MITRE ATLAS — the mapping `guardbee-proxy report` uses |

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

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
