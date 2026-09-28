# @guardbee/mcp-a2a-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — bir agent'ın kendi **Agent2Agent (A2A) protokol implementasyonunu** anti-pattern'ler için tarar. Bu kalıplar spec metninden uydurulmadı, doğrudan referans SDK'lardan (`@a2a-js/sdk`, `a2a-sdk`) ve onların kendi resmi örnek kodundan okundu.

A2A'nın henüz alıntılanacak MCP-tarzı bir "Security Considerations" bölümü yok. Bu yüzden tahmin etmek yerine, bu paketin kalıpları referans SDK kaynağının kendisinde bulunan üç şeye dayanıyor: resmi push-notification sender'ı hiçbir host kontrolü yapmadan client-sağlanan bir webhook URL'ini fetch ediyor, resmi *örnek* agent boş bir security scheme ve literal bir `noAuthentication` request handler'ıyla geliyor, ve Python SDK'sının `AgentCard(...)` constructor'ı iki security kwarg'ını tamamen opsiyonel kabul ediyor — onları geçmezseniz sessizce "auth yok" anlamına geliyor.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, taranan kod hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► a2a-auditor ──► A2A agent'ınızın kaynak kodu
              │
              ├─ webhook-ssrf            (push-notification webhook URL'i allowlist olmadan fetch ediliyor)
              ├─ missing-authentication  (Agent Card / request handler hiç auth gerektirmiyor)
              └─ credential-exposure     (herkese açık servis edilen Agent Card metadata'sında literal credential)
```

---

## Neden özellikle bu üçü

**Webhook SSRF** çünkü referans `DefaultPushNotificationSender` tam olarak `const url = pushConfig.url; ... fetch(url, ...)` yapıyor — `pushConfig.url` task güncellemelerine abone olan client tarafından ayarlanıyor, ve SDK bunu hiçbir host doğrulaması yapmadan fetch ediyor. Bu kodu çalıştıran bir server'a bir caller, server'ın ağından erişilebilir dahili bir servise, bir cloud metadata endpoint'ine ya da başka herhangi bir yere işaret edebilir.

**Eksik authentication** çünkü SDK'nın kendi örnek agent'ı (`src/samples/agents/movie-agent`) `securitySchemes: {}`, `securityRequirements: []`, ve `userBuilder: UserBuilder.noAuthentication` ile geliyor — bir placeholder gibi görünen ama işlevsel olarak "herkesten gelen her isteği kabul et" anlamına gelen, copy-paste'e uygun bir şekil. Python SDK'sı aynı hata modunu açık bir boş değer yerine yokluk üzerinden yaşıyor: `AgentCard(...)` hiçbir zaman `security_schemes`/`security_requirements` gerektirmiyor, bu yüzden referans örnekleri takip ederek kurulan gerçek bir agent, hiç auth'suz kalabilir ve bunu size söyleyen bir hata da olmaz.

**Credential exposure** çünkü bir Agent Card herkese açık servis ediliyor — `/.well-known/agent-card.json`'a (ya da eşdeğer discovery yanıtına) erişebilen herkes onu okuyabilir, *kartın kendisini fetch etmek* için hiçbir authentication gerekmiyor. Bu JSON'un içinde oturan literal bir API key, etkin olarak herkese açıktır.

---

## Özellikler

- **3 kategori**: webhook-ssrf, missing-authentication, credential-exposure
- **Hem TypeScript hem Python A2A kodu** — SDK'lar aynı hata için farklı idiom'lar kullanıyor (boş obje vs. yok sayılan kwarg), bu yüzden bu paket ikisini de kontrol ediyor, sadece birini değil
- Altı kontrolden ikisi tek bir çağrı konumuyla eşleşmek yerine birkaç satır boyunca veri akışını takip ediyor: webhook kontrolü, kullanan `fetch()`'i işaretlemeden önce bir `url` değişkenini geriye doğru `pushConfig.url` şeklindeki bir atamaya kadar takip ediyor, ve credential kontrolü, içinde literal bir secret aramadan önce tam Agent Card obje aralığını (brace-eşleştirmeli) çıkarıyor — bu yüzden dosyadaki herhangi bir `apiKey:`'i değil, sadece Agent Card içindekini işaretliyor
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 18 unit test — her kalıp için hem pozitif hem negatif (yanlış-pozitif) senaryo, artı geliştirme sırasında bulunan gerçek bir hata için bir regresyon testi (`\bAgentCard`, `movieAgentCard` içinde eşleşmiyor — küçük harften büyük harfe geçişte word boundary yok — sınıf adını bir son-ek olarak eşleştirecek şekilde düzeltildi). Hem TypeScript hem Python'da kasıtlı olarak tüm kalıpların yerleştirildiği fixture'lara karşı (hepsi yakalandı) ve tüm guardbee-mcp monorepo'suna karşı (461 dosya — gerçek kodda sıfır bulgu; tek eşleşmeler bu paketin kendi test fixture'ları, pattern-tanımlama kaynağı, ve manifest açıklama metniydi) uçtan uca doğrulandı

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-a2a-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-a2a-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-a2a-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Açıklama |
|------|----------|
| `scan_text` | Bir kod snippet'ini tarar |
| `scan_file` | Tek bir dosyayı tarar |
| `scan_directory` | Bir dizini recursive tarar |
| `list_patterns` | Desteklenen tüm kalıpları kategoriye göre listeler |

---

## Tespit Edilen Kalıplar

| Kategori | Kalıp | Önem |
|---|---|---|
| webhook-ssrf | `webhook_url_direct_fetch_no_allowlist` | critical |
| webhook-ssrf | `webhook_url_indirect_fetch_no_allowlist` | critical |
| missing-authentication | `no_authentication_user_builder` | critical |
| missing-authentication | `empty_agent_card_security` | high |
| missing-authentication | `python_agent_card_no_auth` | high |
| credential-exposure | `agent_card_credential_in_metadata` | high |

---

## Yapılandırma (`guardbee.yml`)

```yaml
a2a-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## Kısıtlamalar (bilinçli tasarım)

- **Heuristic, tam bir A2A conformance testi değil.** Bu, referans SDK'nın kendi kaynağından alınan belirli anti-pattern'leri bulur, çalışan bir agent'a karşı canlı bir protokol conformance kontrolü değil. A2A genç, hızlı hareket eden bir spec — zamanla henüz burada kapsanmayan yeni hata modları ortaya çıkacak.
- **Veri-akışı kontrolleri (dolaylı webhook fetch, Agent Card credential aralığı) sınırlı bir metin penceresi ve bracket-eşleştirme kullanır**, gerçek bir parser değil — daha dolaylı bir zincirden atanan bir `url` değişkeni (örn. bir yardımcı fonksiyondan geçirilen) doğru takip edilmez, ne de tek bir literal yerine birden fazla `Object.assign()`-tarzı birleştirmeye yayılmış bir Agent Card objesi.
- **Adlandırma-konvansiyonuna bağımlı.** Kontroller `pushConfig.url`, `*AgentCard`, `UserBuilder.noAuthentication` şeklindeki tanımlayıcıları arıyor — bunları SDK'nın kendi konvansiyonlarından uzağa yeniden adlandıran kod tanınmaz, bu ailedeki her pattern-tabanlı tarayıcının sahip olduğu aynı kısıtlama.

---

## Geliştirme

```bash
npm run build
npm test             # 18 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
