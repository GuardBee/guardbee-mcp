# @guardbee/mcp-threat-rules

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

**[Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules)** için GuardBee MCP köprüsü — AI agent tehditleri için açık, Sigma benzeri tespit standardı (prompt injection, tool poisoning, context exfiltration, MCP saldırıları).

ATR **çalışma zamanı olaylarını** değerlendirir. GuardBee’nin diğer paketleri çoğunlukla **kaynak/katalog tarar**. Bu paket ikisini bağlar: ATR **+ GuardBee kuralları** (KVKK / Türkçe injection / lethal-trifecta) çalışır; eşleşmede ilgili auditor’a yönlendirir.

Proje kuralları: `.guardbee/atr-rules/` veya `GUARDBEE_ATR_RULES_DIR`.

> Varsayılan telemetri açık (tool adı + kısa parametreler; içerik gitmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). `GUARDBEE_TELEMETRY=0`.

Upstream ATR MIT lisanslıdır; fork etmek yerine `agent-threat-rules` bağımlılığı kullanılır.

## Tool'lar

| Tool | Amaç |
|---|---|
| `evaluate_text` | Serbest metni ATR ile skorla |
| `evaluate_event` | Yapılandırılmış ATR `AgentEvent` JSON |
| `list_rules` | Yüklü ATR kurallarını listele |
| `explain_bridge` | ATR ↔ GuardBee eşlemesini açıkla |

## CLI

```
npx @guardbee/mcp-threat-rules eval "Ignore previous instructions…"
npx @guardbee/mcp-threat-rules list --category=tool-poisoning
```
