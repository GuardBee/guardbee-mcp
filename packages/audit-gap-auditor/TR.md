# @guardbee/mcp-audit-gap-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

MCP server kaynağını **OWASP MCP08:2025 — Lack of Audit and Telemetry** boşlukları için tarayan bir MCP server.

`security-proxy` gateway'de hash-zincirli audit log yazar. Bu paket farklı bir soru sorar: tool çalıştığında MCP *server'ın kendisi* kullanılabilir ve sızdırmayan bir iz bırakıyor mu?

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler; taranan kod hiç gitmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► audit-gap-auditor ──► MCP server kaynağı
              │
              ├─ missing-telemetry  (tool var, audit/log/telemetry yok)
              ├─ unsafe-logging     (ham tool args/result loglanıyor)
              ├─ disabled-audit     (audit/telemetry kaynakta kapalı)
              └─ silent-failure     (tool hataları boş catch ile yutuluyor)
```

## Ne yakalar

| Pattern | Severity | OWASP | Anlamı |
|---|---|---|---|
| `mcp_server_without_tool_audit` | high | MCP08:2025 | Tool kaydı var, dosyada audit/telemetry yok |
| `raw_tool_args_logged` | critical | MCP08:2025 | `args`/`params` olduğu gibi loglanıyor |
| `raw_tool_result_logged` | high | MCP08:2025 | `result` olduğu gibi loglanıyor |
| `audit_disabled_in_code` | high | MCP08:2025 | `audit: false` / `GUARDBEE_TELEMETRY=0` |
| `tool_error_swallowed_silently` | medium | MCP08:2025 | Boş catch |
| `audit_log_without_correlation_id` | medium | MCP08:2025 | Audit olayında session/request id yok |

## Hızlı başlangıç

```bash
npx @guardbee/mcp-audit-gap-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```
