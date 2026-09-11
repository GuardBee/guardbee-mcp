# @guardbee/mcp-vulnerability-scanner

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-vulnerability-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-vulnerability-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-vulnerability-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-vulnerability-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Claude konuşmasından doğrudan GuardBee güvenlik taraması başlatın. OWASP kontrollerini çalıştırın, bulguları sorgulayın ve yapay zekanın düzeltme önerileri önceliklendirmesini isteyin.

> **GuardBee API anahtarı gereklidir.** [app.guardbee.ai/developers](https://app.guardbee.ai/developers) adresinden alın.

---

## Özellikler

- **Claude'dan Tarama Başlat** — Herhangi bir URL'de tek komutla GuardBee taraması tetikle
- **Durum Sorgulama** — Tarama ilerlemesini ve özet sayıları gerçek zamanlı kontrol et
- **Bulgu Filtreleme** — Severity, tarama ID veya brand ID'ye göre sorgula
- **Düzeltme Rehberliği** — Her bulgu için açıklama ve yapılabilir tavsiye
- **Tarama Senaryoları** — `quick`, `kvkkFocus`, `gdprFocus`, `ccpaFocus`
- **36 Tarama Modülü** — GuardBee'nin tüm modülleri desteklenir
- **25 Unit Test** — API çağrısı gerektirmeyen test paketi

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-vulnerability-scanner
```

`claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "guardbee-vulnerability-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-vulnerability-scanner"],
      "env": {
        "GUARDBEE_API_KEY": "gb_..."
      }
    }
  }
}
```

API anahtarınızı [app.guardbee.ai/developers](https://app.guardbee.ai/developers) adresinden alın.

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `start_scan` | URL veya brand ID için tarama başlatır; `wait=true` ile tamamlanmasını bekler |
| `get_scan_status` | Tarama ID ile anlık durum ve özet sayıları |
| `list_scans` | Workspace'teki taramaları filtreli listeler |
| `get_findings` | Bulguları severity / scanId / brandId filtresiyle getirir |
| `scan_and_report` | Tara + bekle + critical/high bulguları ve düzeltme önerilerini döndür |

### Örnek Kullanım

Claude'a şunu sorabilirsiniz:

> "https://example.com adresini tara ve güvenlik raporunu ver"

> "Son taramalarımı listele"

> "clz001 taramasındaki kritik bulguları göster ve nasıl düzelteceğimi anlat"

> "example.com'u KVKK odaklı tara"

### Örnek Çıktı

```
⚠️  Security scan complete for https://example.com
   Scan ID  : clz001abc
   🔴 Critical : 2
   🟠 High     : 5
   🟡 Medium   : 8
   🔵 Low      : 3
   ⚪ Info     : 12
   ✅ Passed   : 18

Use get_findings with scanId="clz001abc" to see details and remediation steps.
```

---

## Tarama Senaryoları

| Senaryo | Açıklama |
|---------|----------|
| `quick` | Tüm 36 modül — kapsamlı genel tarama |
| `kvkkFocus` | KVKK uyum modülleri odaklı |
| `gdprFocus` | GDPR uyum modülleri odaklı |
| `ccpaFocus` | CCPA uyum modülleri odaklı |

---

## Ortam Değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `GUARDBEE_API_KEY` | GuardBee API anahtarı **(zorunlu)** |
| `GUARDBEE_BASE_URL` | Özel endpoint (varsayılan: `https://app.guardbee.ai`) |

---

## Geliştirme

```bash
npm install
npm test          # 25 unit test
npm run build     # TypeScript derleme
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
