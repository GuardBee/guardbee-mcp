# @guardbee/mcp-security-engineer

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

**GuardBee AI Güvenlik Mühendisi**'nin bulgularını kendi kodlama ajanınla (Claude Code, Cursor, VS Code) kendi deponda düzelt, ardından düzeltmeyi canlı sitede doğrula.

GuardBee sorunu bulur, açıklar ve platformuna uygun bir düzeltme önerir. Değişikliği deponda kodlama ajanın yapar, sen onaylarsın. GuardBee kodunda veya sunucularında hiçbir değişiklik yapmaz.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

## Araçlar

| Araç | Ne yapar |
|---|---|
| `list_assessments` | Çalışma alanının son AI Güvenlik Mühendisi değerlendirmeleri |
| `get_assessment` | Aksiyon gerektiren bulgular (en yüksek öncelik önce) ve her birinin düzeltilebileceği platformlar |
| `detect_stack` | Next.js, Express, Nginx, Apache veya Cloudflare'i **deponun kendi dosyalarından** tespit eder ve diff alınabilecek yapılandırma dosyalarını bulur |
| `get_fix` | Bulgu için incelenebilir bir düzeltme getirir. Nginx veya Apache yapılandırmanı verirsen birebir diff üretir. |
| `report_applied` | Düzeltmenin uygulandığını commit SHA veya PR URL'siyle kaydeder |
| `verify_fix` | Deploy sonrası bulguyu üreten kontrolü canlı sitede yeniden çalıştırır |

## Kurulum

1. GuardBee'de **Geliştiriciler → API anahtarları** bölümünden `remediations.read` ve `remediations.write` kapsamlarına sahip bir anahtar oluştur.
2. Sunucuyu ajanına ekle.

**Claude Code**

```bash
claude mcp add guardbee-security-engineer -e GUARDBEE_API_KEY=gb_... -- npx -y @guardbee/mcp-security-engineer
```

**Cursor / VS Code** (`mcp.json`)

```json
{
  "mcpServers": {
    "guardbee-security-engineer": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-security-engineer"],
      "env": { "GUARDBEE_API_KEY": "gb_..." }
    }
  }
}
```

## Örnek

> "Son değerlendirmemdeki öncelikli GuardBee bulgularını bu depoda düzelt."

Ajan:

1. Önce `list_assessments`, ardından `get_assessment` çağırır.
2. `detect_stack` çağırır. Örneğin Next.js'i ve `deploy/nginx.conf` dosyasını bulur.
3. Her bulgu için `get_fix` çağırır, `next.config.js`'i veya Nginx yapılandırmasını düzenler ve sana diff'i gösterir.
4. Onaylayıp commit'ledikten sonra commit SHA'sıyla `report_applied` çağırır.
5. Deploy ettikten sonra `verify_fix` çağırır; GuardBee sorunun çözüldüğünü doğrular.

## Yapılandırma

| Değişken | Varsayılan |
|---|---|
| `GUARDBEE_API_KEY` | zorunlu |
| `GUARDBEE_BASE_URL` | `https://app.guardbee.ai` |
| `GUARDBEE_TELEMETRY` | kapalı; `1` anonim kullanım telemetrisini açar |

## Güvenlik

- Sunucu yalnızca proje kökü içindeki dosyaları ve yalnızca senin belirttiğin yapılandırma dosyasını okur; kök dışındaki yollar reddedilir.
- Dosya düzenlemelerini kendi ajanın yapar; onayı da orada sen verirsin.
- Tüm işlemler GuardBee etkinlik kaydında, MCP istemcisinden geldiği belirtilerek tutulur.

## Lisans

MIT
