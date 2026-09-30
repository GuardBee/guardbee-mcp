# @guardbee/mcp-toxic-flow-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

Bir MCP **tool kataloğunu** **toksik akışlar** (Simon Willison'ın *lethal trifecta*'sı) için denetleyen bir MCP server:

1. **Güvenilmeyen içerik** (fetch, scrape, browse, issue, feed)
2. **Hassas / özel veri** (vault, DB, secret, KVKK kapsamındaki PII)
3. **Sızdırma veya yıkım** (send, webhook, export, delete, drop)

Aynı MCP server bu üçünü birden açıyorsa, tek bir prompt injection bunları zincirleyebilir. Başlıca eşleme: **OWASP MCP10:2025**.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler; taranan kod hiç gitmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► toxic-flow-auditor ──► tools/list JSON veya MCP server kaynağı
              │
              ├─ lethal_trifecta      (güvenilmeyen + hassas + dışarı)
              ├─ single_tool_trifecta (tek tool üç yeteneği birden taşıyor)
              ├─ sensitive_plus_exfil
              ├─ untrusted_plus_exfil
              └─ sensitive_plus_destruct
```

## Ne yakalar

- **Katalog genelinde lethal trifecta.** Güvenilmeyen içerik okuyan, vault/DB/PII'ye ulaşan ve veriyi dışarı gönderen veya silen tool'lar — aynı server'da.
- **Tek-tool trifecta.** İsim/açıklaması üç yeteneği birden kapsayan tek kayıt.
- **Tehlikeli çiftler.** Tam trifecta yokken bile sensitive+exfil, untrusted+exfil veya sensitive+destructive.
- **KVKK bilinci.** `tc_kimlik`, `müşteri`, `KVKK` gibi Türkçe PII sinyalleri hassas veri sayılır.
- **snake_case isimler kelime kelime okunur.** `read_vault_secret` ve `drop_table` her kelimesine göre sınıflandırılır; pull request açmak exfiltration sayılır.

Not: **A–F**. API anahtarı yok. Sadece statik / katalog analizi — canlı tool çağrısı yok.

Sınıflandırma kuralları [`@guardbee/guard-core`](../guard-core/TR.md)'dan gelir; `@guardbee/mcp-security-proxy` toxic flow'ları çalışma anında aynı kurallarla engeller.

## Tool'lar

| Tool | Amaç |
|---|---|
| `audit_catalog` | `tools/list` biçimli JSON denetle |
| `scan_source` | Kaynak metinden `.tool(...)` kayıtlarını çıkar |
| `scan_file` | Tek dosya |
| `scan_directory` | Özyinelemeli; dosyalar arası tool birleştirme |
| `explain_trifecta` | Modeli açıkla |

## CLI

```
npx @guardbee/mcp-toxic-flow-auditor audit <tools.json> [--fail-on=any] [--format=text|json|sarif]
npx @guardbee/mcp-toxic-flow-auditor scan <path>        [--fail-on=any] [--format=text|json|sarif]
```
