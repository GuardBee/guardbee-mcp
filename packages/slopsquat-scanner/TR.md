# @guardbee/mcp-slopsquat-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

Bir projenin kendi manifest dosyalarında (`package.json`, `requirements.txt`, `pyproject.toml`) beyan edilen her bağımlılığı **gerçek** npm/PyPI registry'sine karşı kontrol eden bir MCP (Model Context Protocol) sunucusu — yerel bir veritabanına değil, gerçek bir ağ sorgusuna karşı.

LLM kod asistanları, ölçülebilir bir oranda gerçekmiş gibi görünen paket isimleri uyduruyor — açık kaynak modeller üzerine yapılan araştırmalar bu oranı yaklaşık %21.7 olarak veriyor. Saldırganlar bunu biliyor ve tam olarak bu isimleri npm/PyPI'de önceden kayıt ettiriyor; böylece aynı öneriyi kopyalayan bir sonraki kişi bir kurulum hatası almıyor — saldırganın kodunu kuruyor. Bu **slopsquatting**'dir ve bir yazım hatası (typo-squat) gibi gözle yakalanacak bir yanlış yazım yoktur: uydurulan isim genellikle gerçek paketten *daha* inandırıcı görünür.

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (araç adı + kısa parametreler, taranan manifest dosyaları asla dahil edilmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md)). `GUARDBEE_TELEMETRY=0` ile kapatabilirsiniz.

```
Claude ──► slopsquat-scanner ──► registry.npmjs.org / pypi.org
              │
              ├─ dependency_not_found            (isim hiçbir yerde yayınlanmamış — critical)
              └─ dependency_recently_published    (var, ama <30 gün önce yayınlanmış — low/informational)
```

---

## Neden yerel bir liste değil, canlı registry sorgusu

Bunun için yerel bir "bilinen kötü" listesi tutmanın bir yolu yok — slopsquat'ın tüm meselesi, belirli bir halüsinasyonu yakalamak için özel olarak, belki de biri `npm install` çalıştırmadan sadece birkaç saat önce kaydedilmiş *yeni* bir isim olmasıdır. Statik bir pattern bunu bilemez; sadece registry'ye "bu tam isim şu an var mı" diye sormak bunu yakalayabilir. Bu paket yalnızca bir projenin kendi **doğrudan beyan ettiği** bağımlılıkları kontrol eder (`package.json`'ın `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` bölümleri, ya da Python için `requirements.txt`/`pyproject.toml`) — lockfile'ın tamamen çözümlenmiş ağacını değil. Transitive bağımlılıklar, onlara bağımlı olan paketi yayınlayan bakımcı tarafından zaten gerçek bir registry'ye karşı doğrulanmıştır; asıl risk anı, (bir insan ya da bir AI asistanı tarafından) *yeni* bir ismin doğrudan sizin kendi manifest dosyanıza yazıldığı andır.

Hiç var olmayan bir isim kesindir ve **critical** olarak raporlanır — siz ya da bir takım arkadaşınız kurmadan önce doğru ismi teyit edin. Var olan ama son 30 gün içinde yayınlanmış bir isim ise **low/informational** olarak raporlanır, critical değil: bu, gerçek yeni paketler için de sıradandır ve tek başına kötü niyetli bir şey kanıtlamaz — bir "bir daha bak" sinyalidir, bir hüküm değil.

---

## Özellikler

- **npm ve PyPI** kontrolü — package.json, requirements.txt ve pyproject.toml (hem PEP 621 `[project] dependencies` hem de Poetry'nin `[tool.poetry.dependencies]` tablosu)
- Yalnızca doğrudan bağımlılıklar — hızlı, ve gerçek slopsquatting riskinin olduğu yerle örtüşüyor
- Scoped npm paketleri (`@scope/name`) doğru şekilde işleniyor — geliştirme sırasında gerçek bir URL-encoding hatası bulundu ve düzeltildi (`encodeURIComponent`'i ismin tamamına uygulamak, registry'nin kendi `@scope%2Fname` kuralını çift encode ediyor ve registry'nin tek bir paket olarak tanımadığı bir URL üretiyor)
- API anahtarı gerekmiyor — public, kimlik doğrulamasız npm registry ve PyPI JSON API'sini doğrudan sorguluyor
- SARIF 2.1.0 çıktısı — CI/CD entegrasyonu (GitHub Code Scanning vb.)
- Manifest parser'larını (transitive lockfile girdilerinin doğru şekilde *dahil edilmediğinin* kontrolü dahil) ve severity sınıflandırma mantığını kapsayan 18 birim testi, hepsi gerçek, deterministik fixture'lara karşı — mocklanmış ağ çağrısı yok, çünkü parsing ve sınıflandırma buna ihtiyaç duymayan saf fonksiyonlar. Gerçek npm ve PyPI registry'lerine karşı uçtan uca doğrulandı: gerçek paketleri (`react`, `vitest`, `requests`) ve kasıtlı olarak uydurulmuş isimleri karıştıran bir fixture ile — uydurulmuş her iki isim de yakalandı, gerçek paketlerde sıfır yanlış pozitif. Ayrıca bu monorepo'nun kendi `package.json` dosyalarına karşı dogfooding kontrolü olarak çalıştırıldı: gerçek bağımlılıklarda sıfır yanlış pozitif, ve gerçekten doğru bir low-severity bulgu (`@guardbee/mcp-telemetry`, o sırada npm'de henüz ~2 haftalıktı) — tam olarak amaçlanan "bir bak, ama alarm değil" davranışı.

---

## Hızlı Başlangıç

### Claude Desktop / MCP İstemcisi

```json
{
  "mcpServers": {
    "guardbee-slopsquat-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-slopsquat-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-slopsquat-scanner scan . --fail-on=critical --format=sarif > results.sarif
```

---

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `scan_npm` | Bir dizinin package.json'ında beyan edilen her npm bağımlılığını gerçek npm registry'sine karşı kontrol eder |
| `scan_pip` | Beyan edilen her pip bağımlılığını (requirements.txt / pyproject.toml) gerçek PyPI registry'sine karşı kontrol eder |
| `check_package` | Tek bir paket ismini npm veya PyPI'a karşı kontrol eder |
| `scan_directory` | Bir dizindeki npm ve pip manifest dosyalarını otomatik tespit edip her ikisini de kontrol eder |

---

## Tespit Edilen Pattern'ler

| Pattern | Severity | Anlamı |
|---|---|---|
| `dependency_not_found` | critical | Beyan edilen paket ismi registry'de hiç yok |
| `dependency_recently_published` | low | Paket var, ama ilk yayınlanması 30 günden az |

---

## Yapılandırma (`guardbee.yml`)

```yaml
slopsquat-scanner:
  fail-on: critical    # critical | low | none
  include-dev: false
```

---

## Sınırlamalar (bilinçli tasarım kararları)

- **Yalnızca doğrudan bağımlılıklar.** *Transitive* bir bağımlılığın içindeki (bağımlı olduğunuz bir paketin kendi bağımlı olduğu) uydurulmuş ya da squat edilmiş bir isim kontrol edilmez — o paketin kendi bakımcıları, onu yayınlarken zaten gerçek bir registry'ye karşı doğrulamıştır.
- **"Yakın zamanda yayınlanmış" sinyali gerçekten belirsizdir.** Gerçek yeni paketler sürekli yayınlanır; bu bilinçli olarak low severity'de raporlanır çünkü kötü niyetli bir şeyin *kanıtı* değil, sadece "biraz daha yakından bak" uyarısıdır.
- **Ağa bağımlıdır.** Her kontrol, npm/PyPI registry'sine yapılan canlı bir HTTP isteğidir — çok sayıda bağımlılığı olan bir proje çok sayıda istek demektir (aynı anda en fazla 8 eşzamanlı ile sınırlı), ve bir registry kesintisi ya da rate limit, yanlış bir "yok" bulgusu olarak değil, bir araç hatası olarak görünür (registry hataları gerçek bir 404'ten ayrı raporlanır).
- **Versiyon pin farkındalığı yok.** Bu, *ismin* var olup olmadığını kontrol eder, pinlediğiniz belirli versiyon aralığının şüpheli olup olmadığını değil — bu farklı, zaten kapsanan bir problemdir (bilinen CVE kontrolü için bkz. [`@guardbee/mcp-dependency-auditor`](../dependency-auditor/TR.md)).

---

## Geliştirme

```bash
npm run build
npm test             # 18 birim testi
```

---

## Lisans

MIT — [GuardBee](https://guardbee.ai)
