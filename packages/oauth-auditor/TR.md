# @guardbee/mcp-oauth-auditor

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

MCP (Model Context Protocol) sunucusu — bir MCP server'ın kendi authorization kodunu **MCP spesifikasyonunun kendi Security Considerations bölümünde adlandırılan OAuth 2.1 anti-pattern'leri** için tarar.

MCP spec'i bunu tahmine bırakmıyor — bir OAuth resource server olarak davranan bir server için **token passthrough**'u (bir client'ın token'ını değiştirmeden, exchange/re-scope etmeden downstream bir API'ye forward etmek) ve **eksik audience doğrulamasını** (`aud` claim'i bu server için hiç issue edilmemiş bir token'ı kabul etmek) merkezi authorization hata modları olarak açıkça adlandırıyor. Bu paket tam olarak bu ikisini, artı aynı ailenin 3 ilişkili anti-pattern'ini kontrol ediyor.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

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

| Kategori | Kalıp | Önem | OWASP |
|---|---|---|---|
| token-passthrough | `token_passthrough_to_downstream` | critical | MCP07 |
| token-validation | `missing_audience_validation` | high | MCP07 |
| discovery-ssrf | `oauth_discovery_ssrf` | critical | MCP07 |
| pkce | `missing_pkce_on_auth_request` | high | MCP07 |
| redirect-validation | `loose_redirect_uri_validation` | high | MCP07 |
| secrets-exposure | `hardcoded_oauth_client_secret` | high | MCP07 |
| state-handle | `predictable_state_handle` (+ Python) — state / oturum handle'ı `Math.random`, `Date.now` ya da sayaçla üretilmiş | high | MCP07 |
| state-handle | `state_handle_not_bound_to_user` — tool argümanından gelen handle, çağıranın olup olmadığı kontrol edilmeden kullanılıyor | medium | MCP07 |
| mix-up | `missing_iss_validation` — authorization code `iss` kontrol edilmeden kullanılıyor (RFC 9207) | medium | MCP07 |
| auth-url | `auth_url_scheme_not_validated` — sunucunun verdiği URL scheme kontrolü olmadan açılıyor (`javascript:`, `data:`, `file:`) | high | MCP07 |
| auth-url | `auth_url_opened_via_shell` — URL kabuk üzerinden `open` / `xdg-open` / `start` komutuna ekleniyor | critical | MCP05 |
| local-exposure | `local_http_server_unauthenticated` — kimlik doğrulaması olmayan HTTP MCP transport'u | high | MCP07 |
| local-exposure | `missing_host_origin_check` — Host / Origin kontrolü yok (DNS rebinding) | medium | MCP07 |
| local-exposure | `listen_all_interfaces` — MCP sunucusu `0.0.0.0` adresinde dinliyor | medium | MCP07 |

### Python ve Go

Dil dosya uzantısından anlaşılır; Python'a ve Go'ya özgü kurallar yalnızca kendi dosyalarında çalışır.

- **Python** (FastAPI / Starlette / Flask, PyJWT, python-jose, authlib): `python_missing_audience_validation` (`audience=` ve authlib `claims_options` `aud` olmadan `jwt.decode`), `python_audience_verification_disabled` (`"verify_aud": False`), `python_token_passthrough_to_downstream` (`Authorization` başlığı ya da tüm `request.headers` bir `requests` / `httpx` / client çağrısında), `code_challenge` olmadan authlib `create_authorization_url` / `authorize_redirect` için `missing_pkce_on_auth_request`, ayrıca discovery SSRF, redirect, state ve `0.0.0.0` kuralları.
- **Go** (golang-jwt / jwx, go-oidc, golang.org/x/oauth2, go-sdk ve mcp-go HTTP transport'ları): `go_missing_audience_validation` (`jwt.WithAudience` olmadan `jwt.Parse`), `go_oidc_client_id_check_skipped`, `go_token_passthrough_to_downstream` (`out.Header.Set("Authorization", r.Header.Get("Authorization"))`), `go_hardcoded_oauth_client_secret`, `go_loose_redirect_uri_validation` (`strings.HasPrefix`), `go_predictable_state_handle` (math/rand, time), `go_oauth_discovery_ssrf`, `go_auth_url_opened_via_shell`, `S256ChallengeOption` olmadan `AuthCodeURL` için `missing_pkce_on_auth_request` ve `listen_all_interfaces` olarak `ListenAndServe(":8080")`.
- **İkisi de**: `token_passthrough_via_variable` — gelen `Authorization` başlığı bir değişkene okunup giden bir isteğe konuyor.

Her bulgu [MCP spesifikasyonu Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices) belgesindeki bölümüne bağlanır (SARIF `helpUri`) ve OWASP MCP Top 10 kimliğini SARIF etiketi olarak taşır. Yeni kurallar dosya bazında çalışan sezgisel kontrollerdir: başka bir modülde yapılan kontrol (auth middleware'i, yardımcı fonksiyondaki `iss` karşılaştırması) görülmez.

### Canlı yoklama

```bash
npx @guardbee/mcp-oauth-auditor probe http://127.0.0.1:3000/mcp
```

Çalışan bir HTTP MCP uç noktasını salt okunur kontrol eder: kimlik bilgisi olmadan `initialize`'a cevap veriyor mu (`probe_unauthenticated_access`), yabancı bir `Host` (`probe_dns_rebinding_host_accepted`) ya da `Origin` (`probe_foreign_origin_accepted`) kabul ediliyor mu? Kimlik bilgisi göndermez, `initialize` dışında hiçbir şey çağırmaz, açtığı oturumu kapatır ve `--allow-public` verilmedikçe genel bir adrese çözülen host'u reddeder. Yalnızca CLI'dan çalışır; bir ajan MCP tool'ları üzerinden başlatamaz.


---

## Yapılandırma (`guardbee.yml`)

```yaml
oauth-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## Kısıtlamalar (bilinçli tasarım)

- **TypeScript/JavaScript, Python ve Go.** Her birinin yaygın kütüphaneleri için kuralları var (yukarıda). Diğer diller (Rust, Java, C#, …) ve diğer kütüphaneler yalnızca bunlarla aynı şekli paylaştıkları yerde eşleşir; örneğin literal bir `client_secret` ya da `response_type=code`.
- **Heuristic, tam bir OAuth conformance testi değil.** Bu, kaynakta belirli anti-pattern'leri bulur, çalışan bir authorization server'a karşı canlı bir protokol conformance kontrolü değil. Bir OAuth akışının yanlış implemente edilebileceği her yolu yakalamaz — sadece MCP spec'inin en yüksek riskli olarak adlandırdığı bir avuç tanesini.
- **Yokluk-tabanlı kontroller (audience, PKCE) sınırlı bir metin penceresi kullanır**, gerçek bir parser değil — options objesi çağrı konumundan uzakta kurulan bir `jwt.verify()` çağrısı (inline bir obje yerine geçirilen bir değişken) `audience` için doğru kontrol edilmez.

---

## Geliştirme

```bash
npm run build
npm test
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)

## Geri bildirim

Sorunuz, öneriniz ya da yanlış bir alarm mı var? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)'ta bir konu açın veya [issue oluşturun](https://github.com/GuardBee/guardbee-mcp/issues). GuardBee işinize yaradıysa [repoya](https://github.com/GuardBee/guardbee-mcp) bir ⭐ başkalarının da bulmasına yardım eder.
