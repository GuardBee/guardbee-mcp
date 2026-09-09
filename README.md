# @guardbee/mcp-ssl-inspector

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

TLS sertifikası, cipher suite ve protokol konfigürasyonlarını herhangi bir domain için inceleyen MCP sunucusu. Node.js yerleşik `tls` modülü kullanır — harici bağımlılık yoktur.

---

## Özellikler

- **Sertifika Denetimi** — Geçerlilik, süre dolumu (gün bazında), SHA-256 fingerprint, SAN'lar, issuer zinciri
- **Protokol Kontrolü** — TLS 1.0/1.1 deprecated uyarısı, SSLv2/v3 kritik uyarısı
- **Cipher Analizi** — NULL, EXPORT, RC4, DES, 3DES, anonim cipher tespiti
- **HSTS Kontrolü** — `Strict-Transport-Security` başlığı, max-age, includeSubdomains
- **Toplu Tarama** — N domain'i paralel olarak tarar
- **Sertifika Expiry İzleme** — Yaklaşan sona erişler için 🚨 / ⚠️ / ✅ simgeleri
- **12 Unit Test** — Harici bağlantı gerektirmeyen saf mantık testleri

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-ssl-inspector
```

`claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "guardbee-ssl-inspector": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-ssl-inspector"]
    }
  }
}
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `inspect_ssl` | Tek bir domain için tam TLS denetimi (sertifika + cipher + protokol + HSTS) |
| `inspect_ssl_bulk` | Birden fazla domain'i paralel olarak denetler |
| `check_cert_expiry` | N domain için sertifika son kullanma tarihlerini kontrol eder |
| `get_cert_info` | Domain için ayrıntılı sertifika bilgisi (fingerprint, SAN, zincir, seri no) |

### Örnek Kullanım

Claude'a şunu sorabilirsiniz:

> "example.com'un SSL sertifikası geçerli mi?"

> "Bu domain'lerin sertifikaları ne zaman sona eriyor: example.com, api.example.com, shop.example.com"

> "example.com zayıf cipher suite kullanıyor mu?"

### Örnek Çıktı

```
┌─ example.com:443
│  Protocol  : TLSv1.3
│  Cipher    : TLS_AES_256_GCM_SHA384 (256 bit)
│  Chain     : depth=2 valid=yes
│  Cert CN   : example.com
│  Validity  : Mar 15 2024 → Jun 13 2024 (expires in 45 days)
│  SANs      : example.com, www.example.com
│  Issuer    : Let's Encrypt
│  SHA-256   : AA:BB:CC:DD:...
│  HSTS      : enabled (max-age=31536000, includeSubdomains)
│  ✅ No security issues found
```

---

## Güvenlik Bulguları

| Bulgu | Severity | Açıklama |
|-------|----------|----------|
| `CERT_EXPIRED` | 🔴 Critical | Sertifika süresi dolmuş |
| `CERT_EXPIRY_CRITICAL` | 🔴 Critical | < 7 gün kaldı |
| `CERT_EXPIRY_SOON` | 🟠 High | < 30 gün kaldı |
| `CERT_EXPIRY_WARN` | 🟡 Medium | < 90 gün kaldı |
| `CERT_CHAIN_INVALID` | 🟠 High | Zincir doğrulama hatası |
| `CERT_NO_SAN` | 🟡 Medium | Subject Alternative Name yok |
| `DEPRECATED_PROTOCOL` | 🟠 High | TLS 1.0 veya 1.1 |
| `OBSOLETE_PROTOCOL` | 🔴 Critical | SSLv2 veya SSLv3 |
| `WEAK_CIPHER` | 🔴 Critical | NULL/EXPORT/RC4/anon cipher |
| `NO_HSTS` | 🟡 Medium | HSTS başlığı bulunamadı |
| `HSTS_SHORT_MAX_AGE` | 🔵 Low | max-age < 15552000s |

---

## Geliştirme

```bash
npm install
npm test          # 12 unit test
npm run build     # TypeScript derleme
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
