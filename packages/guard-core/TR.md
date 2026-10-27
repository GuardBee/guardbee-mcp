# @guardbee/guard-core

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

Diğer GuardBee MCP paketlerinin kullandığı ortak dedektörler. Kendi başına bir MCP server değil, sadece bir kütüphane — bu paketi doğrudan kurmanız gerekmez.

Amacı, aynı kuralın her yerde çalışması: bir kalıbı raporlayan statik tarayıcı ile onu çalışma anında engelleyen proxy tek bir uygulamayı kullanır.

## İçinde neler var

| Export | Kullanan | Amaç |
|---|---|---|
| `maskPiiInText`, `maskPiiInValue`, `PII_PATTERNS` | security-proxy | Tool sonuçlarında TC Kimlik No, VKN, IBAN, kart, telefon, e-posta, sağlayıcı API key'leri, özel anahtarlar, bağlantı dizeleri ve JWT'leri maskeler; isteğe bağlı bir replacer eşleşmeleri token'a çevirir |
| `SpanLookup`, `ModelDetector`, `MODEL_PII` | @guardbee/ner, pii-bench | Bir modelin bulduklarını (`@guardbee/ner` ile kişi adları) aynı geçişte maskeler. Önce model metinler üzerinde çalıştırılır, sonra sonuçlar bir arama fonksiyonu olarak `maskPiiInText`'in beşinci argümanına verilir. Bu fonksiyon sonucu olmayan bir metin için hata fırlatmalı, böylece taranmamış bir metin asla temiz kabul edilmez. `person_name`, `ALL`, `KVKK` ve `IDENTITY` presetlerinde bir dedektör adı; arama fonksiyonu verilmezse hiçbir şey bulmaz |
| `SPECIAL_CATEGORIES`, `KVKK_SENSITIVE` preset'i | security-proxy, pii-bench | Dokuz KVKK m.6 özel nitelikli kategori (sağlık, din ve inanç, etnik köken, siyasi düşünce, sendika üyeliği, ceza mahkûmiyeti, cinsel hayat, biyometrik, genetik). Her kategori için bir terim listesi var. Terimler yalnızca metin bir kişiyle ilgiliyse maskelenir: arama fonksiyonundan gelen bir isim, kişisel bir tanımlayıcı ya da birini işaret eden bir sözcük. İsteğe bağlıdır: `KVKK_SENSITIVE` (`KVKK` ve bunlar) dışında hiçbir presette yoktur, `include` ile adıyla da açılabilir |
| `SECRET_RULES` | secret-scanner, security-proxy | 76 secret kuralı (sağlayıcı anahtar ve token'ları — bulut, AI sağlayıcıları, geliştirici araçları, SaaS, Türk ödeme ve SMS sağlayıcıları — özel anahtarlar, bağlantı dizeleri, JWT). Tarayıcı hepsini raporlar; proxy `broad` işaretli olmayan 66'sini maskeler |
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
| Telefon (TR) | Cep (5xx), sabit hat (2xx–4xx) veya 850 kodu; +90 / 0 önekiyle, parantez içinde alan koduyla ya da boşluk, tire veya nokta ile gruplanmış yazılmış olmalı, bir URL'nin veya kimliğin parçası olmamalı. Öneksiz 10 haneli cep numarası yalnızca bunu söyleyen bir sözcükten sonra sayılır (`numaram`, `tel`, `cep`, `iletişim`) |

Kontrolden geçemeyen eşleşme (sipariş no, takip kodu) olduğu gibi bırakılır.

## Kodlanmış ve gizlenmiş değerler

Bir tool'un kodlanmış döndürdüğü ya da regex'ten kaçırmak için gizlenmiş bir değer, düz yazılmış hâli gibi maskelenir:

- **Karakter kaçışları:** HTML entity'leri (`&#49;`, `&#x31;`, `&commat;`), JS/JSON kaçışları (`\u0031`, `\x31`), URL kaçışları (`%40`; boşluklar arasındaki tek başına `%50` yüzde olarak kalır).
- **Benzer görünen karakterler:** tam genişlikli ve matematiksel rakamlar (NFKC), başka yazı sistemlerinin rakamları (Arapça-Hint `١٢٣`, Devanagari `१२३`…), sıfır genişlikli karakterler.
- **base64, base64url, hex:** okunabilir metne açılan bir dizi maskelenir ve aynı biçimde (alfabe ve dolgu korunarak) yeniden kodlanır; en fazla iki kat iç içe. İkili veriye açılan diziler (hash, görsel, anahtar) olduğu gibi kalır.
- **Ayraçlı ve yazıyla yazılmış biçimler:** TC etiketinden sonra `TC: 100 000 001 46`, `+90.532.123.45.67`, `ahmet [at] example [dot] com`.

Tespit açılmış bir kopya üzerinde çalışır; maskeleme değerin yazıldığı karakterlere geri eşlenir, çevresindeki her şey yazıldığı gibi kalır. Replacer açılmış değeri alır, böylece vault bir değerin her yazımına aynı token'ı verir. Kapsam dışı: alanlara bölünmüş ya da ters yazılmış değerler ve kodlanmış dizi içindeki isimler (NER modeli metni gönderildiği hâliyle görür). pii-bench'in bypass suite'i bunu ölçer (`pnpm --filter @guardbee/pii-bench bypass`).

## Kesin ve genel kurallar

Injection ve secret kuralları, sıradan metinde de eşleşen kalıplar için bir `broad` bayrağı taşır: "act as", "developer mode", 40 karakterlik herhangi bir base64 dizisi, yayınlanabilir (publishable) bir Stripe anahtarı. Bulguyu bir kişiye gösteren statik tarayıcılar genel injection kurallarını atlar; çalışma anındaki proxy ise genel bir kurala dayanarak asla engelleme veya maskeleme yapmaz, çünkü oradaki yanlış bir eşleşme oturumu hassas veri tutuyor diye de işaretler ya da meşru bir çağrıyı durdurur.

## Geri bildirim

Sorunuz, öneriniz ya da yanlış bir alarm mı var? [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions)'ta bir konu açın veya [issue oluşturun](https://github.com/GuardBee/guardbee-mcp/issues). GuardBee işinize yaradıysa [repoya](https://github.com/GuardBee/guardbee-mcp) bir ⭐ başkalarının da bulmasına yardım eder.
