# @guardbee/mcp-dns-intelligence

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

DNS kayıtlarını sıralayan, SPF / DMARC / DKIM yapılandırma hatalarını tespit eden ve asılı (dangling) subdomain'leri bulan MCP sunucusu. Node.js yerleşik `dns/promises` kullanır — harici bağımlılık yoktur.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

---

## Özellikler

- **Tam DNS Sıralaması** — A, AAAA, MX, NS, TXT, CNAME, SOA kayıtları
- **SPF Analizi** — `+all`, `?all`, yinelenen kayıtlar ve alıcı sunucuların saydığı biçimde RFC 7208 sınırları: iç içe `include`/`redirect` dahil DNS sorguları (en fazla 10), boş sorgular (en fazla 2), include döngüleri ve eksik include'lar
- **DMARC Analizi** — Politika (`none`/`quarantine`/`reject`), `pct`, `rua` adresi eksikliği
- **DKIM Kontrolü** — 9 yaygın seçici probu (`default`, `google`, `selector1`, `mail`, vb.)
- **Subdomain Keşfi** — Certificate Transparency kayıtlarından adlar (crt.sh ve Cert Spotter paralel sorgulanır; yalnızca alan adı gönderilir) ve 75 adlık kelime listesi; wildcard DNS ayıklanır; her canlı ad subdomain ele geçirmeye karşı kontrol edilir
- **E-posta Güvenliği Özeti** — SPF + DMARC + DKIM birleşik analizi ve kopyalanabilir düzeltme önerileri
- **23 Unit Test** — Ağ bağlantısı gerektirmeyen saf mantık testleri

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-dns-intelligence
```

`claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "guardbee-dns-intelligence": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-dns-intelligence"]
    }
  }
}
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `enumerate_dns` | Domain için tüm DNS kayıtlarını sıralar ve SPF/DMARC/DKIM analizi yapar |
| `enumerate_subdomains` | Yaygın subdomain'leri dener (wildcard'ı ayırt eder); subdomain ele geçirmelerini tespit eder |
| `check_takeover` | Verilen host adlarını subdomain ele geçirmeye karşı kontrol eder |
| `check_email_security` | SPF + DMARC + DKIM birleşik denetimi ve düzeltme önerileri |
| `lookup_dns` | Belirli bir kayıt türü için hedefli DNS sorgusu (A/MX/TXT/vb.) |

### Örnek Kullanım

Claude'a şunu sorabilirsiniz:

> "example.com'un DNS yapılandırmasında sorun var mı?"

> "example.com'un e-posta güvenliğini denetle — SPF, DMARC ve DKIM"

> "example.com'un subdomain'lerini listele, asılı olanları işaretle"

> "example.com'un MX kayıtları neler?"

### Örnek Çıktı

```
Email Security Check: example.com
──────────────────────────────────────────────────

── SPF ─────────────────────────────────────────
✓ v=spf1 include:_spf.google.com -all

── DMARC ───────────────────────────────────────
✗ No DMARC record found at _dmarc.example.com
  Add:  v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com

── DKIM ────────────────────────────────────────
✓ Found DKIM selectors: google
```

---

## SPF Bulguları

| Kod | Severity | Açıklama |
|-----|----------|----------|
| `SPF_MISSING` | 🟡 Medium | SPF kaydı bulunamadı |
| `SPF_PERMISSIVE_ALL` | 🔴 Critical | `+all` — her sunucuya izin veriyor |
| `SPF_NEUTRAL_ALL` | 🟠 High | `?all` — yetkisiz gönderenleri reddetmiyor |
| `SPF_NO_ALL` | 🟡 Medium | `all` mekanizması yok |
| `SPF_TOO_MANY_LOOKUPS` | 🟠 High | > 10 DNS sorgusu — SPF hatasına yol açar |
| `SPF_DUPLICATE` | 🟠 High | Birden fazla SPF kaydı |
| `SPF_AT_LOOKUP_LIMIT` | 🔵 Low | Tam 10 sorgu — bir include daha SPF'yi bozar |
| `SPF_TOO_MANY_VOID_LOOKUPS` | 🟠 High | 2'den fazla include kayıt döndürmüyor |
| `SPF_INCLUDE_MISSING` | 🟠 High | Bir `include`/`redirect` hedefinde SPF kaydı yok (permerror) |
| `SPF_INCLUDE_DUPLICATE` | 🟠 High | Dahil edilen alan adı birden fazla SPF kaydı yayınlıyor |
| `SPF_INCLUDE_LOOP` | 🟠 High | Include'lar değerlendirilen kayda geri dönüyor |
| `SPF_PTR` | 🔵 Low | Kullanımdan kalkmış `ptr` mekanizması |

## DMARC Bulguları

| Kod | Severity | Açıklama |
|-----|----------|----------|
| `DMARC_MISSING` | 🟠 High | DMARC kaydı yok |
| `DMARC_NO_POLICY` | 🟠 High | `p=` politikası eksik |
| `DMARC_POLICY_NONE` | 🟡 Medium | `p=none` — izleme modu, engelleme yok |
| `DMARC_PCT_LOW` | 🔵 Low | `pct` < 100 — kısmi uygulama |
| `DMARC_NO_RUA` | 🔵 Low | Toplu rapor adresi (`rua`) yok |
| `DMARC_MULTIPLE` | 🟠 High | Birden fazla DMARC kaydı — alıcılar hepsini yok sayar |
| `DMARC_INVALID_POLICY` | 🟠 High | `p=` değeri none, quarantine veya reject değil |
| `DMARC_SUBDOMAINS_NONE` | 🟡 Medium | `sp=none` alt alan adlarını taklide açık bırakır |
| `DOMAIN_NOT_FOUND` | 🟠 High | Alan adı yok (NXDOMAIN) |

Kendi DMARC kaydı olmayan alt alan adları, alıcıların yaptığı gibi üst alan adının kaydını (`sp=` politikasıyla) devralır. Alt alan adı taraması wildcard DNS'i tespit eder ve yalnızca wildcard'ın yanıtladığı adları listelemez.

## DKIM, MX ve Taşıma Güvenliği Bulguları

| Kod | Önem | Açıklama |
|-----|----------|----------|
| `DKIM_NOT_FOUND` | 🟡 Medium | ~35 yaygın seçicide DKIM anahtarı yok (kendi seçicinizi `dkimSelectors` ile verin) |
| `DKIM_KEY_WEAK` | 🟠 High | 1024 bitten küçük RSA anahtarı |
| `DKIM_KEY_1024` | 🟡 Medium | 1024 bit RSA anahtarı — 2048'e yenileyin (RFC 8301) |
| `DKIM_KEY_INVALID` | 🟡 Medium | Yayınlanan anahtar okunamıyor |
| `DKIM_TESTING` | 🔵 Low | `t=y` test modu |
| `MX_UNRESOLVABLE` | 🟠 High | Bir MX sunucusunun A/AAAA kaydı yok |
| `MTA_STS_MISSING` | 🔵 Low | MTA-STS yok: gelen posta düz metne düşürülebilir |
| `MTA_STS_MX_MISMATCH` | 🟠 High | Enforce politikası canlı bir MX'i listelemiyor — uyumlu göndericiler teslim etmez |
| `MTA_STS_POLICY_UNREACHABLE` / `_INVALID` | 🟡 Medium | Politika dosyası yok, yönlendiriliyor veya bozuk — göndericiler MTA-STS'i yok sayar |
| `MTA_STS_TESTING` / `_MODE_NONE` / `_MAX_AGE_SHORT` | 🔵 Low | Uygulanmıyor, geri çekilmiş veya `max_age` bir günden kısa |
| `TLSRPT_MISSING` / `_INVALID` | 🔵 Low | MTA-STS'in yanında kullanılabilir TLS-RPT yok |

`SPF_MISSING`, alan adının MX kaydı varsa 🟠 High (başlangıç kaydıyla, örn. Google Workspace için `v=spf1 include:_spf.google.com ~all`), yoksa 🟡 Medium'dur (`v=spf1 -all` önerilir).

## Subdomain Ele Geçirme Tespiti

CNAME'i olan her canlı subdomain, CNAME zinciri (en fazla 5 adım) izlenerek kontrol edilir. Wildcard kaydı da kontrol edilir: asılı bir `*.alanadi`, listelenmeyen her adı ele geçirilebilir yapar.

| Risk | Ne zaman | Sağlayıcılar |
|---|---|---|
| ⚠️ **ele geçirilebilir** | Sağlayıcı adı herkesin almasına izin verir | AWS S3 (`NoSuchBucket` sayfası), Microsoft Azure ve AWS Elastic Beanstalk (CNAME hedefi NXDOMAIN), Surge.sh (`project not found`) ve **kayıtsız** bir alan adına giden her CNAME |
| ⚠️ **elle doğrula** | Kaynak silinmiş ama sağlayıcı alan adı doğrulaması isteyebilir | GitHub Pages, Heroku, Netlify, Vercel, Ghost, Pantheon, WordPress.com, Help Scout, Tumblr, ngrok |
| 🧹 **bayat** | Hedef silinmiş ama yalnızca sahibinin kontrol ettiği kayıtlı bir alan adı altında — kaydı silin; ele geçirme değildir, CI'ı kırmaz | diğer sağlayıcılar |

Her sayfa parmak izi, sağlayıcıdaki rastgele sahiplenilmemiş bir adla doğrulandı; "bulunamadı" sayfası artık sabit bir işaret taşımayan sağlayıcılar listede yok. HTTP kontrolleri subdomain'e tek bir `GET /` gönderir (önce HTTPS, sonra HTTP); `--no-http` / `httpProbe: false` ile kapatılır. Bildiğiniz host adları için `check_takeover` / `takeover <host…>` kullanın.

---

## CLI — CI/CD Entegrasyonu

MCP server moduna ek olarak doğrudan CLI olarak da kullanılabilir:

```bash
# Tam DNS + e-posta güvenliği kontrolü
npx @guardbee/mcp-dns-intelligence check example.com

# Sadece high ve üstünde başarısız ol
npx @guardbee/mcp-dns-intelligence check example.com --fail-on=high

# Subdomain taraması — dangling CNAME varsa exit 1
npx @guardbee/mcp-dns-intelligence subdomains example.com

# Yüksek concurrency ile subdomain tarama
npx @guardbee/mcp-dns-intelligence subdomains example.com --concurrency=50

# JSON çıktı
npx @guardbee/mcp-dns-intelligence check example.com --format=json
```

**Exit kodları:** `0` = sorun yok · `1` = threshold üstü bulgu / dangling subdomain · `2` = hata

### guardbee.yml ile Konfigürasyon

Proje kökünde `guardbee.yml` oluşturarak CLI flag'lerini kalıcı hale getirebilirsiniz. CLI flag'leri her zaman dosya ayarlarını geçersiz kılar.

```yaml
dns-intelligence:
  fail-on: high          # critical | high | medium | low
  concurrency: 20        # paralel subdomain probe sayısı
  domains:               # CLI'da domain verilmezse bu liste kullanılır
    - example.com
    - staging.example.com
```

Örnek dosya için [`guardbee.example.yml`](guardbee.example.yml) dosyasına bakın.

### GitHub Actions — DNS Güvenlik Denetimi

```yaml
name: DNS Security Check
on:
  schedule:
    - cron: "0 6 * * *"  # Her gün 06:00
  workflow_dispatch:

jobs:
  dns-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check DNS configuration
        run: npx @guardbee/mcp-dns-intelligence check ${{ vars.DOMAIN }} --fail-on=high

      - name: Scan for dangling subdomains
        run: npx @guardbee/mcp-dns-intelligence subdomains ${{ vars.DOMAIN }}
```

### GitLab CI

```yaml
dns-security:
  image: node:20
  script:
    - npx @guardbee/mcp-dns-intelligence check $DOMAIN --fail-on=high
    - npx @guardbee/mcp-dns-intelligence subdomains $DOMAIN
  only:
    - schedules
```

### Deployment Öncesi E-posta Güvenliği Kontrolü

```yaml
- name: Verify email security records
  run: |
    npx @guardbee/mcp-dns-intelligence check ${{ vars.DOMAIN }} \
      --fail-on=high \
      --format=json | tee dns-report.json

- name: Upload DNS report
  uses: actions/upload-artifact@v4
  with:
    name: dns-security-report
    path: dns-report.json
```

---

## Geliştirme

```bash
npm install
npm test          # 23 unit test
npm run build     # TypeScript derleme
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
