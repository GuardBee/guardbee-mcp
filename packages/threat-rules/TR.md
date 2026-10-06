# @guardbee/mcp-threat-rules

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

**[Agent Threat Rules (ATR)](https://github.com/Agent-Threat-Rule/agent-threat-rules)** için GuardBee MCP köprüsü — AI agent tehditleri için açık, Sigma benzeri tespit standardı (prompt injection, tool poisoning, context exfiltration, MCP saldırıları).

ATR **çalışma zamanı olaylarını** değerlendirir. GuardBee’nin diğer paketleri çoğunlukla **kaynak/katalog tarar**. Bu paket ikisini bağlar: ATR **+ GuardBee kuralları** (KVKK / Türkçe & Çince injection / Çin kimlik / lethal-trifecta) çalışır; eşleşmede ilgili auditor’a yönlendirir.

Proje kuralları: `.guardbee/atr-rules/` veya `GUARDBEE_ATR_RULES_DIR`.

> Varsayılan telemetri açık (tool adı + kısa parametreler; içerik gitmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). `GUARDBEE_TELEMETRY=0`.

Upstream ATR MIT lisanslıdır; fork etmek yerine `agent-threat-rules` bağımlılığı kullanılır.

## Tool'lar

| Tool | Amaç |
|---|---|
| `evaluate_text` | Serbest metni ATR + GuardBee ile skorla |
| `evaluate_file` | Yerel dosya tara |
| `evaluate_event` | Yapılandırılmış ATR `AgentEvent` JSON |
| `list_rules` | Yüklü kurallar (`source=atr\|guardbee`) |
| `rule_stats` | Kategori/kaynak sayıları |
| `explain_bridge` | ATR ↔ GuardBee eşlemesini açıkla |

## CLI

```
npx @guardbee/mcp-threat-rules eval "…" --format=json --fail-on=high
npx @guardbee/mcp-threat-rules scan ./prompt.txt --format=sarif
npx @guardbee/mcp-threat-rules list --source=guardbee
npx @guardbee/mcp-threat-rules stats
```
