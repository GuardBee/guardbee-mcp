# @guardbee/mcp-prompt-leak-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — ve bağımsız bir reverse proxy — **outbound** LLM prompt'larındaki sızmış credential ve PII'yi, uygulamanızdan çıkmadan önce yakalar.

`secret-scanner` kod tabanınızda duran sırları bulur. Bu paket ise bir *runtime prompt*'a giren sır ve PII'yi bulur — bir müşteri destek agent'ının bir ticket'ı (email, kart no) doğrudan system prompt'a yapıştırması, birinin debug sırasında bir chat'e API key yapıştırması, ham kullanıcı girdisini hiç kontrol etmeden LLM'e ileten bir internal tool. Bu, pipeline'da farklı bir an ve sızmış bir `.env` dosyasından farklı bir hata modu.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, prompt içeriği ve audit bulguları hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Uygulamanız ──► prompt-leak-scanner (proxy) ──► Gerçek LLM API (OpenAI/Anthropic/...)
                    │
                    ├─ monitor: değiştirmeden ilet, bulguları logla
                    ├─ redact:  eşleşmeleri [REDACTED:<id>] ile değiştirip ilet
                    └─ block:   isteği modele hiç ulaşmadan reddet
```

---

## İki kullanım şekli

**1. Talep üzerine tarama (MCP tool'ları)** — `scan_text`/`scan_messages`/`scan_file`/`scan_directory`. Kullanıcı girdisinden prompt oluşturan bir şeyi shipping'lemeden önce Claude'a bir prompt'u, bir chat-request-body fixture'ını ya da bir prompt log dizinini kontrol ettirin.

**2. Canlı bir reverse proxy (`proxy` CLI komutu)** — uygulamanızla gerçek LLM API arasına oturur. Sadece **outbound request body**'yi (message/system metni) buffer'layıp inceler, sonra upstream response'u değiştirmeden doğrudan geri stream eder — yani SSE/streaming completion'lar dokunulmadan geçer; sadece dışarı giden prompt hiç parse edilir. Uygulamanızın `baseURL`'ini gerçek API yerine proxy'ye yönlendirin, entegrasyonunuzda başka hiçbir şeyin değişmesi gerekmiyor.

```bash
guardbee-prompt-leak-scanner proxy --upstream=https://api.openai.com --port=8788 --mode=redact
# uygulamanız: baseURL = http://localhost:8788 (https://api.openai.com yerine)
```

---

## Tespit kalitesi: sadece regex değil, checksum

"11 hane" ya da "16 hane" için çıplak bir regex sipariş numaralarını, telefon dahili hatlarını, timestamp'leri sürekli işaretlerdi. Gerçek bir checksum algoritması olan her PII kalıbı onu kullanıyor:

- **TC Kimlik No** — gerçek 11 haneli Türkiye kimlik checksum algoritması (sadece hane-sayısı regex'i değil)
- **Kredi kartı numaraları** — Luhn checksum
- **IBAN** — ISO 7064 MOD97-10 checksum

Rastgele 11 haneli bir sayının TC Kimlik checksum'ını tesadüfen geçme ihtimali kabaca 10'da 1 — tek başına regex çok daha gürültülü olurdu. Credential kalıpları (API key, JWT, private key) gerçek sağlayıcıya-özgü prefix/yapılara karşı eşleştiriliyor (`sk-`, `AKIA`, `ghp_`, `-----BEGIN...PRIVATE KEY-----`, JWT'nin üç-segmentli base64url şekli) — `secret-scanner`'ın kullandığı aynı düşük-yanlış-pozitif yaklaşım.

**Bulgular gerçek değeri asla tam göstermez.** Bir bulgunun `maskedMatch`'i sadece ilk 3 ve son 2 karakteri gösterir (`sk-…wx`) — az önce yakaladığınız şeyi loglamak ya da göstermek amacı boşa çıkarırdı. Proxy'nin audit event'leri daha da ileri gider: hangi kalıbın tetiklendiğini ve nerede olduğunu kaydeder, eşleşen metni asla değil.

---

## Özellikler

- **13 kalıp, 4 kategori**: credential (9), financial-pii (2, checksum-validated), national-id (1, checksum-validated), contact-pii (2)
- **Chat-body farkında** — OpenAI/Anthropic tarzı `messages[].content`'i (string ya da content-block array) ve `system` alanlarını anlıyor, sadece düz metni değil
- monitor/redact/block politikalarıyla **canlı reverse-proxy modu** — sadece request inceleniyor, response dokunulmadan stream ediliyor
- Maskelenmiş bulgular ve credential-içermeyen audit event'leri — araç sızıntının ikinci bir kopyası haline gelmiyor
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 29 unit test — checksum doğrulayıcıları bilinen-geçerli/bilinen-geçersiz test vektörlerine karşı doğrulandı, proxy her üç modda gerçek bir lokal HTTP client/server round trip'ine karşı (sadece in-process mock değil) test edildi

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-prompt-leak-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-prompt-leak-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-prompt-leak-scanner scan ./prompt-fixtures --fail-on=high --format=sarif > results.sarif
```

### CLI (canlı proxy)

```bash
npx @guardbee/mcp-prompt-leak-scanner proxy --upstream=https://api.openai.com --mode=block --fail-on-severity=critical
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_text` | Ham bir metin string'ini tarar |
| `scan_messages` | OpenAI/Anthropic tarzı bir chat request body objesini tarar |
| `scan_file` | Tek bir dosyayı tarar (düz metin, ya da bir JSON request-body fixture'ı — otomatik tespit edilir) |
| `scan_directory` | Bir prompt log/fixture dizinini recursive tarar |
| `list_patterns` | Desteklenen tüm kalıpları kategoriye göre listeler |

---

## Tespit Edilen Kalıplar

| Kategori | Kalıp | Önem |
|---|---|---|
| credential | OpenAI / Anthropic / Google / Stripe API key, AWS access key ID, GitHub PAT, Slack token, PEM private key block | critical |
| credential | JWT | high |
| financial-pii | Kredi kartı numarası (Luhn-validated) | high |
| financial-pii | IBAN (mod-97 validated) | high |
| national-id | TC Kimlik No (checksum-validated) | high |
| contact-pii | Email adresi | medium |
| contact-pii | Türkiye telefon numarası | medium |

---

## Yapılandırma (`guardbee.yml`)

```yaml
prompt-leak-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - "fixtures/known-safe/"
```

---

## Kısıtlamalar (bilinçli tasarım)

- Proxy sadece **request** body'sini inceler; streaming SSE response'ları parse etmez ya da değiştirmez — bunlar dokunulmadan geçer.
- Bir chat body'sinden sadece `messages[].content` (string ya da `{type:"text"}` content block'ları) ve üst-seviye `system` çıkarılır; bu şeklin dışındaki sağlayıcıya-özgü alanlar taranmaz.
- Bu kalıp/checksum tabanlı bir tespit, genel amaçlı bir NER/PII modeli değil — bilinen yapısal bir kalıpla eşleşmeyen PII'yi (örn. serbest metindeki bir isim ya da adres) yakalamaz.

---

## Geliştirme

```bash
npm run build
npm test             # 29 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
