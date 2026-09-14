# @guardbee/mcp-security-proxy

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Herhangi bir MCP sunucusunun önüne oturan şeffaf güvenlik katmanı. Prompt injection saldırılarını engeller, yanıtlardaki PII'yi maskeler ve her isteği değiştirilemez audit log'a yazar.

> Bu paket varsayılan olarak GuardBee'ye kullanım telemetrisi gönderir (tool adı + kısa parametreler, bkz. [`@guardbee/mcp-telemetry`](../telemetry/README.md)) — bu, kendi local audit log'undan ayrı ve bağımsızdır. Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► MCP Security Proxy ──► Herhangi bir MCP Sunucu
                │
                ├─ Prompt injection tespiti  (16 saldırı deseni)
                ├─ PII maskeleme             (TC kimlik, IBAN, e-posta, JWT, API key)
                ├─ Block veya warn modu
                └─ Yapılandırılabilir audit log
```

---

## Özellikler

- **Prompt Injection Koruması** — 16 saldırı deseni ile sistem prompt'larını geçersiz kılmaya çalışan istekler engellenir
- **PII Maskeleme** — TC kimlik no, IBAN, e-posta, telefon, JWT token, API key yanıtlarda otomatik maskelenir
- **Block / Warn Modu** — Her interceptor bağımsız olarak engelleyici veya uyarı modunda çalışabilir
- **Audit Log** — Console veya dosyaya yazılan yapılandırılabilir log
- **Sıfır Kod Değişikliği** — Mevcut herhangi bir MCP sunucusunun önüne takılır

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-security-proxy
```

`claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "secure-filesystem": {
      "command": "npx",
      "args": [
        "-y", "@guardbee/mcp-security-proxy",
        "--", "npx", "-y",
        "@modelcontextprotocol/server-filesystem", "/tmp"
      ]
    }
  }
}
```

> Proxy, `--` sonrasındaki komutu hedef MCP sunucu olarak başlatır.

---

## MCP Tools

Proxy, tool'ları hedef sunucudan şeffaf olarak aktarır ve her geçişte interceptor zincirini uygular. Ek olarak aşağıdaki yönetim tool'unu sunar:

| Tool | Açıklama |
|------|----------|
| `proxy_status` | Aktif interceptor'ları ve son engellenen istek istatistiklerini gösterir |

---

## Interceptor'lar

### Prompt Injection Detector

Gelen mesajlarda aşağıdaki saldırı desenlerini arar:

- `ignore previous instructions`
- `disregard your system prompt`
- `you are now [DAN/jailbreak]`
- ANSI escape dizileri ile gizlenmiş komutlar
- Base64 kodlanmış talimatlar
- ve 11 desen daha

### PII Masker

| Veri Tipi | Örnek Girdi | Çıktı |
|-----------|------------|-------|
| TC Kimlik | `12345678901` | `[TC-REDACTED]` |
| IBAN | `TR320006200...` | `TR32***` |
| E-posta | `ahmet@example.com` | `ah***@example.com` |
| JWT | `eyJhbGc...` | `[JWT-REDACTED]` |
| API Key | `sk-abc123...` | `[KEY-REDACTED]` |

---

## Yapılandırma

Ortam değişkenleri ile yapılandırılabilir:

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `PROXY_MODE` | `block` | `block` veya `warn` |
| `PROXY_LOG` | `console` | `console` veya `file` |
| `PROXY_LOG_PATH` | `./proxy-audit.jsonl` | Log dosya yolu |
| `PROXY_PII_MASK` | `true` | PII maskelemeyi etkinleştir |
| `PROXY_INJECTION_CHECK` | `true` | Injection kontrolünü etkinleştir |

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
