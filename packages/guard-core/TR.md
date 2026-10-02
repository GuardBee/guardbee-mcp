# @guardbee/guard-core

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

Diğer GuardBee MCP paketlerinin kullandığı ortak dedektörler. Kendi başına bir MCP server değil, sadece bir kütüphane — bu paketi doğrudan kurmanız gerekmez.

Amacı, aynı kuralın her yerde çalışması: bir kalıbı raporlayan statik tarayıcı ile onu çalışma anında engelleyen proxy tek bir uygulamayı kullanır.

## İçinde neler var

| Export | Kullanan | Amaç |
|---|---|---|
| `maskPiiInText`, `maskPiiInValue`, `PII_PATTERNS` | security-proxy | Tool sonuçlarında TC Kimlik No, VKN, IBAN, kart, telefon, e-posta, sağlayıcı API key'leri, özel anahtarlar, bağlantı dizeleri ve JWT'leri maskeler; isteğe bağlı bir replacer eşleşmeleri token'a çevirir |
| `SECRET_RULES` | secret-scanner, security-proxy | 38 secret kuralı (sağlayıcı anahtar ve token'ları, özel anahtarlar, bağlantı dizeleri, JWT). Tarayıcı hepsini raporlar; proxy `broad` işaretli olmayan 32'sini maskeler |
| `isValidTcKimlik`, `isValidVkn`, `isValidIban`, `isValidLuhn`, `isValidTrPhone` | security-proxy, prompt-leak-scanner | Regex eşleşmesinden sonra doğrulama |
| `INJECTION_RULES`, `findInjections` | prompt-injection-scanner, security-proxy | İngilizce ve Türkçe 27 injection kuralı, base64 çözme dahil; tarayıcı 17 kesin kuralı kullanır |
| `scanForPromptInjection`, `scanToolResult` | security-proxy | Kesin bir high/critical kuralda engeller, geri kalan her şeyde uyarır |
| `gatewayPolicySchema`, `validatePolicy`, `policyShape` | security-proxy, app.guardbee.ai | Gateway politika belgesi (etiketler, kurallar, taint, onay, varsayılanlar, interceptor'lar). Dashboard bir düzenlemeyi kaydetmeden önce bununla doğrular; kaydedilen politika proxy'nin kabul ettiği politikadır |
| `classifyTool`, `CAPABILITY_RULES` | toxic-flow-auditor, security-proxy | Bir tool'u untrusted-content / sensitive-data / exfiltration / destructive olarak etiketler (lethal trifecta) |

## Checksum doğrulamalı maskeleme

Tek başına regex, 11 haneli her sayıyı TC Kimlik No, 16 haneli her sayıyı kart numarası sanar. Artık her eşleşme maskelenmeden önce kontrol edilir:

| Kalıp | Kontrol |
|---|---|
| TC Kimlik No | Resmi 10. ve 11. hane algoritması |
| VKN (vergi kimlik no) | Gelir İdaresi kontrol hanesi ve sayıdan önce bir `VKN` / `Vergi No` etiketi |
| IBAN | ISO 7064 MOD97-10 |
| Kart numarası | Luhn |
| Telefon (TR) | Cep (5xx), sabit hat (2xx–4xx) veya 850 kodu; +90 / 0 önekiyle ya da boşluk/tire ile gruplanmış yazılmış olmalı, bir URL'nin veya kimliğin parçası olmamalı |

Kontrolden geçemeyen eşleşme (sipariş no, takip kodu) olduğu gibi bırakılır.

## Kesin ve genel kurallar

Injection ve secret kuralları, sıradan metinde de eşleşen kalıplar için bir `broad` bayrağı taşır: "act as", "developer mode", 40 karakterlik herhangi bir base64 dizisi, yayınlanabilir (publishable) bir Stripe anahtarı. Bulguyu bir kişiye gösteren statik tarayıcılar genel injection kurallarını atlar; çalışma anındaki proxy ise genel bir kurala dayanarak asla engelleme veya maskeleme yapmaz, çünkü oradaki yanlış bir eşleşme oturumu hassas veri tutuyor diye de işaretler ya da meşru bir çağrıyı durdurur.
