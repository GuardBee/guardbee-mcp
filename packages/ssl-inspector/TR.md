# @guardbee/mcp-ssl-inspector

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

TLS sertifikası, cipher suite ve protokol konfigürasyonlarını herhangi bir domain için inceleyen MCP sunucusu. Node.js yerleşik `tls` modülü kullanır — harici bağımlılık yoktur.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

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
| `CERT_EXPIRY_SOON` | 🟠 High | < 21 gün kaldı (ACME istemcileri 30 günde yeniler: yenileme bozulmuş) |
| `CERT_EXPIRY_WARN` | 🟡 Medium | < 30 gün kaldı |
| `HOSTNAME_MISMATCH` | 🔴 Critical | Sertifika bu host için geçerli değil |
| `CERT_REVOKED` | 🔴 Critical | Sertifika iptal edilmiş |
| `CERT_SELF_SIGNED` | 🟠 High | Self-signed sertifika |
| `CERT_CHAIN_INCOMPLETE` | 🟠 High | Sunucu ara sertifikasını göndermiyor |
| `CERT_CHAIN_INVALID` | 🟠 High | Diğer zincir doğrulama hataları |
| `WEAK_KEY` | 🟠 High / 🔴 Critical | 2048 bitten küçük RSA anahtarı (1024 altı critical), 256 bitten küçük EC anahtarı |
| `WEAK_SIGNATURE` | 🟠 High | Sertifika ya da ara sertifika SHA-1 veya MD5 ile imzalı |
| `CERT_NO_SAN` | 🟡 Medium | Subject Alternative Name yok |
| `DEPRECATED_PROTOCOL` | 🟠 High | Sunucu hâlâ TLS 1.0 ya da 1.1 kabul ediyor (tarama) |
| `OBSOLETE_PROTOCOL` | 🔴 Critical | SSLv2 veya SSLv3 |
| `WEAK_CIPHER` | 🔴 Critical / 🟠 High | NULL/EXPORT/RC4 (critical) ya da 3DES (high) şifreleri kabul ediyor (tarama) |
| `WEAK_DH` | 🟠 High / 🔴 Critical | 2048 bitten küçük Diffie-Hellman grubu (1024 altı critical) (tarama) |
| `NO_FORWARD_SECRECY` | 🟡 Medium | RSA anahtar değişimli şifreleri kabul ediyor (tarama) |
| `NO_HSTS` | 🟡 Medium | HSTS başlığı yok |
| `HSTS_SHORT_MAX_AGE` | 🔵 Low | max-age < 15552000s |
| `NO_TLS13` | 🔵 Low | TLS 1.3 desteklenmiyor (tarama) |
| `NO_OCSP_STAPLING` | 🔵 Low | Stapled OCSP yanıtı yok |
| `NO_CAA` | 🔵 Low | Alan adı ya da üst alan adları için CAA DNS kaydı yok |

**Taramalar.** Tek bir varsayılan handshake, iki tarafın ortak olduğu en iyi protokol ve şifrede anlaşır; bu yüzden TLS 1.0 ya da RSA anahtar değişimini *de* kabul eden bir sunucu sorunsuz görünür. `inspect_ssl` ve CLI bu yüzden her biri yalnızca test edilen şeyi sunan birkaç ek handshake yapar (TLS 1.0, TLS 1.1, TLS 1.3, RSA anahtar değişimi, DHE, zayıf şifre aileleri). Çalışma ortamının kendi OpenSSL'inin sunamadığı zayıf aileler (Node 22 derlemelerinde 3DES/RC4/EXPORT yok) geçti sayılmaz, *test edilemedi* olarak listelenir. `--no-probes` / `probes: false` bunları atlar; `inspect_ssl_bulk` istenmedikçe çalıştırmaz.

---

## CLI — CI/CD Entegrasyonu

MCP server moduna ek olarak doğrudan CLI olarak da kullanılabilir:

```bash
# Tek domain tam TLS denetimi
npx @guardbee/mcp-ssl-inspector inspect example.com

# Birden fazla domain
npx @guardbee/mcp-ssl-inspector inspect example.com api.example.com shop.example.com

# Özel port
npx @guardbee/mcp-ssl-inspector inspect example.com:8443

# Sertifika expiry kontrolü
npx @guardbee/mcp-ssl-inspector expiry example.com api.example.com

# Sadece critical'da başarısız ol
npx @guardbee/mcp-ssl-inspector inspect example.com --fail-on=critical

# JSON çıktı
npx @guardbee/mcp-ssl-inspector inspect example.com --format=json
```

**Exit kodları:** `0` = sorun yok · `1` = threshold üstü bulgu / süresi dolmuş sert · `2` = hata

### guardbee.yml ile Konfigürasyon

Proje kökünde `guardbee.yml` oluşturarak CLI flag'lerini kalıcı hale getirebilirsiniz. CLI flag'leri her zaman dosya ayarlarını geçersiz kılar.

```yaml
ssl-inspector:
  fail-on: high          # critical | high | medium | low
  port: 443
  hosts:                 # CLI'da domain verilmezse bu liste kullanılır
    - example.com
    - api.example.com
    - shop.example.com
```

Örnek dosya için [`guardbee.example.yml`](guardbee.example.yml) dosyasına bakın.

### GitHub Actions — Deployment Sonrası Kontrol

```yaml
name: SSL Check
on:
  workflow_run:
    workflows: ["Deploy"]
    types: [completed]

jobs:
  ssl-check:
    runs-on: ubuntu-latest
    steps:
      - name: Inspect SSL certificate
        run: npx @guardbee/mcp-ssl-inspector inspect ${{ vars.DOMAIN }} --fail-on=high

      - name: Check cert expiry (warn if < 30 days)
        run: npx @guardbee/mcp-ssl-inspector expiry ${{ vars.DOMAIN }}
```

### Scheduled Expiry Monitor

```yaml
name: Cert Expiry Monitor
on:
  schedule:
    - cron: "0 9 * * 1"  # Her Pazartesi 09:00

jobs:
  expiry:
    runs-on: ubuntu-latest
    steps:
      - name: Check certificate expiry dates
        run: |
          npx @guardbee/mcp-ssl-inspector expiry \
            example.com \
            api.example.com \
            shop.example.com \
            --format=json
```

### GitLab CI

```yaml
ssl-inspect:
  image: node:20
  script:
    - npx @guardbee/mcp-ssl-inspector inspect $DOMAIN --fail-on=high
  environment:
    name: production
  only:
    - main
```

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
