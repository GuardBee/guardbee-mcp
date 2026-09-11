# @guardbee/mcp-compliance-checker

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

KVKK, GDPR ve CCPA uyum kontrollerini GuardBee API ile çalıştıran, gizlilik politikalarını analiz eden ve yasal gereksinimleri karşılaştıran MCP sunucusu. Üç araç API anahtarı gerektirmeden çalışır.

> **GuardBee API anahtarı** `check_compliance` ve `get_compliance_findings` araçları için gereklidir. [app.guardbee.ai/developers](https://app.guardbee.ai/developers) adresinden alın.

---

## Özellikler

- **KVKK / GDPR / CCPA Taraması** — GuardBee API ile uyum odaklı tarama başlatır ve bulguları getirir
- **Gizlilik Politikası Analizi** — URL'den politika metnini çeker; 10 uyum sinyali, puan (0-100) ve harf notu
- **Çerez Banner Tespiti** — OneTrust, Cookiebot, Axeptio ve 10+ CMP platform tespiti
- **Gereksinim Kataloğu** — KVKK (9), GDPR (8), CCPA (4) yasal madde referanslarıyla 21 gereksinim
- **Çerçeve Karşılaştırması** — KVKK / GDPR / CCPA arasındaki ortak ve farklı maddeler
- **API Anahtarsız Araçlar** — `analyze_privacy_policy`, `list_requirements`, `compare_frameworks` çevrimdışı çalışır

---

## Hızlı Başlangıç

```bash
npm install -g @guardbee/mcp-compliance-checker
```

`claude_desktop_config.json` dosyasına ekleyin:

```json
{
  "mcpServers": {
    "guardbee-compliance-checker": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-compliance-checker"],
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

| Tool | API Anahtarı | Açıklama |
|------|:------------:|----------|
| `check_compliance` | Gerekli | URL veya brand ID için uyum taraması başlatır (KVKK/GDPR/CCPA) |
| `get_compliance_findings` | Gerekli | Tarama bulgularını çerçeve ve severity filtresiyle getirir |
| `analyze_privacy_policy` | Hayır | Gizlilik politikası URL'sini analiz eder; puan, not ve eksik maddeler |
| `list_requirements` | Hayır | Desteklenen çerçeveler için yasal gereksinimleri listeler |
| `compare_frameworks` | Hayır | KVKK, GDPR ve CCPA arasındaki benzerlikleri ve farklılıkları karşılaştırır |

### Örnek Kullanım

Claude'a şunu sorabilirsiniz:

> "example.com'un KVKK uyumunu kontrol et"

> "GDPR gereksinimlerini listele"

> "KVKK ile GDPR arasındaki farkları karşılaştır"

> "https://example.com/privacy adresindeki gizlilik politikasını analiz et"

### Örnek Çıktı

```
Privacy Policy Analysis: https://example.com/privacy
──────────────────────────────────────────────────────
Score : 72/100  Grade: C

✅ Data controller identity disclosed
✅ Purpose of processing stated
✅ Retention periods mentioned
✅ Cookie policy present
❌ Legal basis for processing not stated
❌ Data subject rights not listed (access, erasure, portability)
❌ International transfer safeguards missing
❌ Contact information for DPO missing

Recommendation: Add legal basis statements and data subject rights section.
```

---

## Desteklenen Çerçeveler

| Çerçeve | Gereksinim Sayısı | Tarama Senaryosu |
|---------|:-----------------:|-----------------|
| KVKK | 9 | `kvkkFocus` |
| GDPR | 8 | `gdprFocus` |
| CCPA | 4 | `ccpaFocus` |

---

## Gizlilik Politikası Puanlaması

`analyze_privacy_policy` aracı politika metninde 10 sinyal arar:

| Sinyal | Açıklama |
|--------|----------|
| Veri sorumlusu kimliği | Şirket/kuruluş adı belirtilmiş |
| İşleme amacı | Kişisel verinin neden toplandığı |
| Hukuki dayanak | GDPR Art. 6 / KVKK Md. 5 referansı |
| Saklama süreleri | Verinin ne kadar tutulacağı |
| İlgili kişi hakları | Erişim, silme, taşınabilirlik, itiraz |
| İletişim / DPO | Veri sorumlusuna ulaşma bilgisi |
| Çerez politikası | Çerezler ve izleme teknolojileri |
| Üçüncü taraf paylaşımı | Veri paylaşılan taraflar |
| Güvenlik önlemleri | Teknik/idari tedbirler |
| Uluslararası transfer | Yurt dışı aktarım güvenceleri |

**Notlar:** A (90-100) · B (75-89) · C (60-74) · D (45-59) · F (0-44)

---

## Ortam Değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `GUARDBEE_API_KEY` | GuardBee API anahtarı (check_compliance ve get_compliance_findings için zorunlu) |
| `GUARDBEE_BASE_URL` | Özel endpoint (varsayılan: `https://app.guardbee.ai`) |

---

## Geliştirme

```bash
npm install
npm test          # unit testler
npm run build     # TypeScript derleme
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
