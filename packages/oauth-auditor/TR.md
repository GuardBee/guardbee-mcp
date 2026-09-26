# @guardbee/mcp-oauth-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

MCP (Model Context Protocol) sunucusu — bir MCP server'ın kendi authorization kodunu **MCP spesifikasyonunun kendi Security Considerations bölümünde adlandırılan OAuth 2.1 anti-pattern'leri** için tarar.

MCP spec'i bunu tahmine bırakmıyor — bir OAuth resource server olarak davranan bir server için **token passthrough**'u (bir client'ın token'ını değiştirmeden, exchange/re-scope etmeden downstream bir API'ye forward etmek) ve **eksik audience doğrulamasını** (`aud` claim'i bu server için hiç issue edilmemiş bir token'ı kabul etmek) merkezi authorization hata modları olarak açıkça adlandırıyor. Bu paket tam olarak bu ikisini, artı aynı ailenin 3 ilişkili anti-pattern'ini kontrol ediyor.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler, taranan kod hiçbir zaman dahil değil — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

```
Claude ──► oauth-auditor ──► MCP server'ınızın auth kodu
              │
              ├─ token-passthrough    (client'ın token'ı değiştirilmeden downstream'e forward ediliyor)
              ├─ token-validation     (jwt.verify() audience kontrolü olmadan)
              ├─ discovery-ssrf       (OAuth/OIDC discovery URL'i client girdisinden kuruluyor)
              ├─ pkce                 (authorization request'te code_challenge eksik)
              ├─ redirect-validation  (redirect_uri startsWith/includes ile kontrol ediliyor, tam eşitlik değil)
              └─ secrets-exposure     (sabit client_secret)
```

---

## Neden özellikle bu ikisi

**Token passthrough** önemli çünkü bir client'ın *bu* server'a sunduğu token, bu server için scope'lanmış ve audience'lanmış — server'ın kendi tool handler'larının sonra çağırdığı herhangi bir downstream API için değil. Değiştirmeden forward etmek, downstream servisin hiç issue etmediği bir credential'a, orijinal token issuer'ının hiç onaylamadığı bir server-side karara dayanarak güvenmesi anlamına geliyor.

**Eksik audience doğrulaması** aynı hatanın diğer yönden hali: `jwt.verify(token, key)` bir token'ın *imzasının* geçerli olduğunu doğruluyor, ama *kimin için* issue edildiği hakkında hiçbir şey söylemiyor. Açık bir `audience` kontrolü olmadan, aynı issuer/signing key'i paylaşan tamamen ilgisiz bir resource server için basılmış bir token, burada da başarıyla doğrulanacak. Bu, MCP spec'inin uyardığı ders kitabı confused-deputy substitution'ı.

Diğer 3 kalıp, aynı "bir MCP server'ın auth kodu güvenmemesi gereken bir şeye güveniyor" temasının bitişik, somut örnekleri: client-sağlanan girdiden kurulan bir OAuth/OIDC discovery URL'i (gerçek, açıklanmış bir CVE'nin arkasındaki şekil), tam eşitlik yerine prefix/substring kontrolüyle doğrulanan bir redirect_uri (open-redirect bypass), ve bir authorization request'ten sessizce eksik PKCE (sadece public client'lar için değil, koşulsuz olarak OAuth 2.1 tarafından gerekli).

---

## Özellikler

- **6 kategori**: token-passthrough, token-validation, discovery-ssrf, pkce, redirect-validation, secrets-exposure
- Kontrollerden ikisi (eksik audience doğrulaması, eksik PKCE) sabit bir regex yerine bir çağrı konumu yakınında bir **yokluğu** arıyor — tam `jwt.verify(...)` çağrısını (ya da authorization-request URL kurulumunu) çıkarıp `audience:` / `code_challenge`'ın gerçekten hiçbir yerde olmadığını doğruluyor, sadece şanslı bir string konumuyla eşleşmiyor
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- `guardbee.yml` ile config dosyası desteği
- 18 unit test — her kalıp için hem pozitif hem negatif (yanlış-pozitif) senaryo, artı sıfır bulgu üreten tamamen-doğru bir OAuth akışı. Geliştirme sırasında gerçek bir regex hatası bulunup düzeltildi (bir `]` karakterinden sonraki trailing `\b` asla eşleşemez, çünkü `]` bir word karakteri değil — header erişiminin bracket-notation formunu sessizce kaçırıyordu). Kasıtlı olarak 6 anti-pattern'in hepsinin yerleştirildiği bir fixture'a karşı (6/6 yakalandı) ve tüm guardbee-mcp monorepo'suna karşı (401 dosya — gerçek üçüncü-taraf kodda sıfır bulgu; test dışı tek eşleşmeler scanner'ın kendi pattern-tanımlama kaynağının bir regex literal'i ve bir doc yorumu içinde `jwt.verify(` string'ini metinsel olarak içermesiydi, gerçek zafiyetli kullanım değil) uçtan uca doğrulandı

---

## Hızlı Başlangıç

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-oauth-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-oauth-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-oauth-auditor scan ./src --fail-on=high --format=sarif > results.sarif
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
| token-passthrough | `token_passthrough_to_downstream` | critical |
| token-validation | `missing_audience_validation` | high |
| discovery-ssrf | `oauth_discovery_ssrf` | critical |
| pkce | `missing_pkce_on_auth_request` | high |
| redirect-validation | `loose_redirect_uri_validation` | high |
| secrets-exposure | `hardcoded_oauth_client_secret` | high |

---

## Yapılandırma (`guardbee.yml`)

```yaml
oauth-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - "**/*.test.ts"
```

---

## Kısıtlamalar (bilinçli tasarım)

- **JS/TS-odaklı kalıplar.** `jwt.verify(`, `fetch(`/`axios(`, template-literal URL kurulumu — eşdeğer hatalara sahip Python/Go/Rust'ta yazılmış bir server isimden tanınmaz, sadece benzer adlandırılmış fonksiyonlar kullanıyorsa aynı temel şekilden tanınır.
- **Heuristic, tam bir OAuth conformance testi değil.** Bu, kaynakta belirli anti-pattern'leri bulur, çalışan bir authorization server'a karşı canlı bir protokol conformance kontrolü değil. Bir OAuth akışının yanlış implemente edilebileceği her yolu yakalamaz — sadece MCP spec'inin en yüksek riskli olarak adlandırdığı bir avuç tanesini.
- **Yokluk-tabanlı kontroller (audience, PKCE) sınırlı bir metin penceresi kullanır**, gerçek bir parser değil — options objesi çağrı konumundan uzakta kurulan bir `jwt.verify()` çağrısı (inline bir obje yerine geçirilen bir değişken) `audience` için doğru kontrol edilmez.

---

## Geliştirme

```bash
npm run build
npm test             # 18 unit test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
