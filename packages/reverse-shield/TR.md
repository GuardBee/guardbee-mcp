# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

Yayınladığın uygulamanın bir tersine mühendise **neyi bedavaya verdiğini** söyleyen bir MCP server.

Tersine mühendislik MCP'leri artık bir agent'ın kaynak kodu olmayan bir uygulamayı (web bundle, Electron uygulaması, APK, iOS uygulaması, oyun, native ya da .NET binary) alıp bir özelliğin nasıl çalıştığını binary seviyesine kadar açıklamasına izin veriyor. Bu paket madalyonun öbür yüzü: onu *kendi* build artifact'ına yönelt; böyle bir aracın (ya da jadx, ILSpy, Il2CppDumper, Hopper veya tarayıcı devtools'u kullanan birinin) hiç uğraşmadan neler elde edeceğini her biri için düzeltmesiyle birlikte raporlar; `suggest_fixes` de bu düzeltmeleri build config'ine karşı bir diff'e çevirir.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

```
Claude ──► reverse-shield ──► build artifact'ın / canlı site
              │
              ├─ web       source map'ler (paketlenmiş, inline, herkese açık), minify edilmemiş / dev bundle, anahtarlar, iç host'lar, WebAssembly debug bilgisi ve isimleri
              ├─ electron  fuse'lar (RunAsNode, --inspect, NODE_OPTIONS, ASAR integrity), açık uygulama kodu, app.asar içindeki kod
              ├─ android   APK ve AAB: debuggable, R8/ProGuard yok, imza şeması, backup, düz React Native bundle, strip edilmemiş .so
              ├─ ios       IPA ve .app: Debug yapılandırmasıyla derlenmiş build, development profili, düz React Native bundle, paket içindeki .dSYM, executable
              ├─ motorlar  Unity (IL2CPP metadata, Mono assembly'leri), PyInstaller, Java/Spring Boot JAR, Flutter (Dart obfuscation)
              ├─ native    debug bilgisi, semboller, get-task-allow, hardened runtime, imza, PIE/NX/RELRO/canary (ELF, Mach-O, PE)
              ├─ secret'lar yukarıdakilerin hepsinde anahtarlar: dex, resources.arsc, plist, config dosyaları, Hermes bytecode, .so ve executable'lar
              └─ .NET      obfuscation yok, gömülü PDB, sızan build yolları
```

`scan_url` dışında her şey yerelde ve çevrimdışı çalışır. ASAR, Electron fuse wire, ikili AndroidManifest (AXML), DEX, ELF, Mach-O (universal binary'ler ve kod imzası dahil) ve PE/.NET metadata için kendi ayrıştırıcıları var; apktool, jadx ya da binutils gerekmez.

## Neyi işaretler

| Kontrol | Önem | Hedef | Neyi ele verir |
|---|---|---|---|
| `sourcemap_embeds_source` | critical | web | `sourcesContent` ile orijinal kaynak kodun tamamı |
| `sourcemap_shipped` / `sourcemap_inline` / `sourcemap_publicly_reachable` | high | web | Orijinal dosya yolları ve yapı |
| `eval_devtool_bundle` | high | web | Her modülün yoluyla birlikte dev bundle |
| `bundle_secret` | anahtar türüne göre | hepsi | İstemci kodunda, bir uygulama paketinde ya da binary'de çalışan bir kimlik bilgisi |
| `wasm_debug_info` | high | web | DWARF'lı WebAssembly: kaynak dosyalar, satırlar, tipler |
| `unminified_bundle` / `dev_build_framework` / `wasm_name_section` | medium | web | Okunabilir kod / framework'ün dev runtime'ı / isimli WebAssembly fonksiyonları |
| `sourcemap_reference` / `internal_endpoint` | low | web | Map'in yeri / localhost, özel IP'ler, staging host'ları |
| `electron_fuse_run_as_node` / `electron_fuse_inspect_args` | high | electron | İmzalı uygulamanın içinde Node runtime'ı ya da debugger |
| `electron_app_unpacked` | high | electron | Düzenlenebilir klasör olarak uygulama kodu |
| `electron_fuse_node_options` / `_asar_integrity_off` / `_load_outside_asar` | medium | electron | Kod enjeksiyonu ve ASAR kurcalama |
| `apk_debuggable` | critical | android | Debugger bağlama ve `run-as` ile uygulama verisine erişim |
| `apk_no_obfuscation` / `apk_js_bundle_plaintext` / `apk_unsigned` | high | android | Gerçek isimlerle jadx çıktısı / okunabilir RN bundle / kurcalama izi yok |
| `apk_allow_backup` / `apk_v1_only_signature` | medium | android | Backup ile çekilen veri / Janus tarzı yeniden paketleme |
| `native_debug_info` / `native_debuggable_entitlement` | high | native | Kaynak seviyesinde debug verisi / lldb ile bağlanma |
| `native_symbols_not_stripped` / `native_no_hardened_runtime` / `native_injection_entitlement` / `native_unsigned` | medium | native | İsimli fonksiyonlar / dylib enjeksiyonu / yamalı kopyaların çalışması |
| `native_no_pie` / `native_no_nx` | medium | native | Exploit'e elverişli sabit adresler / çalıştırılabilir stack |
| `native_no_relro` / `native_no_stack_canary` / `native_adhoc_signed` / `native_build_path_leak` | low | native | Sertleştirme boşlukları ve build makinesi ayrıntıları |
| `ios_debug_build` / `ios_js_bundle_plaintext` / `ios_dsym_shipped` | high | ios | Tam sembollü, optimize edilmemiş kod ve preview stub'ları / okunabilir RN bundle / paket içinde tam DWARF sembolleri |
| `ios_development_profile` | medium | ios | Kayıtlı cihazlarda debugger bağlama |
| `unity_il2cpp_metadata` / `unity_mono_assemblies` | high | motorlar | Oyunun tüm sınıf, metot ve string'leri / dnSpy ile C# script'leri |
| `flutter_not_obfuscated` | high | motorlar | blutter / reFlutter için Dart sınıf ve metot isimleri |
| `python_pyinstaller_bundle` / `java_not_obfuscated` | high | motorlar | Decompile edilebilir `.pyc` dosyaları / orijinal isimleriyle Java sınıfları |
| `dotnet_not_obfuscated` / `dotnet_embedded_pdb` | high | .NET | Orijinal kaynağa çok yakın ILSpy/dnSpy çıktısı |

`list_checks` tüm kataloğu düzeltmeleriyle döndürür. Her sonuç bir **A–F notu** taşır: kritik bir şey (ya da birden fazla high bulgu) açıktaysa F, hiçbir şey yoksa A.

### Zor kontroller nasıl karar veriyor

- **R8/ProGuard**: her `classes*.dex`'ten sınıf tanımlayıcılarını okur ve application id altındaki (`.debug` gibi son ekler için manifest'te adı geçen bileşenlerin paketleri altındaki) sınıflara bakar. Neredeyse hiç bir-iki harfli isim olmadan onlarca açıklayıcı sınıf adı, R8'in çalışmadığı anlamına gelir.
- **.NET obfuscation**: metadata `#Strings` heap'ini okur. Bilinen obfuscator işaretleri (ConfuserEx, Dotfuscator, SmartAssembly, …) doğrudan geçer; aksi halde tanımlayıcıların en az %10'u bir-iki harfli isim, sadece rakam ya da ASCII dışı çöp karakterse assembly geçer. Bir Obfuscar build'ine (%21, geçer) ve obfuscate edilmemiş 400 NuGet assembly'sine (383'ü işaretlendi; kalan 17'si karar verilemeyecek kadar az isim içeren kaynak assembly'leri) karşı doğrulandı.
- **Private key'ler**: sadece PEM başlığından sonra base64 anahtar verisi geliyorsa raporlanır; uygulamalara gömülen kripto kütüphaneleri bu başlığı string sabiti olarak taşır.
- **JavaScript dışındaki kimlik bilgileri**: Android dex string'leri, `resources.arsc` / `resources.pb` string havuzu (`strings.xml` ve google-services değerleri buraya düşer), `assets/` ve `res/raw/`; iOS plist'leri (`GoogleService-Info.plist`) ve executable; ASAR, JAR (Spring Boot `application.properties`) ya da build klasöründeki JSON/plist/`.env`/properties/YAML dosyaları; Hermes bytecode, `.so` kütüphaneleri ve native/.NET binary'ler yazdırılabilir string'leriyle. Bundle'larda olduğu gibi burada da sadece sabit formatlı anahtarlar eşleştirilir. Android veya iOS paketindeki Google/Firebase API anahtarı medium raporlanır: bunlar tasarım gereği pakete girer ve uygulamanın package name'ine ya da bundle id'sine kısıtlanmalıdır.
- **Tekrarlar**: 30 chunk'taki aynı anahtar tek bulgudur ("also in 29 other files"); uzun minify edilmemiş dosya listeleri tek bulguda toplanır.
- **iOS Debug build'leri**: Xcode 16, Debug build'in kodunu `<App>.debug.dylib` içine koyar ve yanına `__preview.dylib` ekler; paketteki ikisinden biri Debug yapılandırmasının yayınlandığını gösterir.
- **Unity**: IL2CPP `global-metadata.dat` sadece standart başlığı bozulmamışsa işaretlenir (korumalı build'ler şifreler); Mono `Assembly-CSharp.dll` .NET isim kontrolünden geçer.
- **PyInstaller**: CArchive işaretçisi dosyanın tamamında aranır (macOS'te arşiv kod imzasından önce kendi bölümündedir); PyArmor ve Nuitka build'leri işaretlenmez, not düşülür.
- **Flutter**: AOT snapshot'taki (`libapp.so`, `App.framework/App`) tanımlayıcıları okur. `--obfuscate` programın tanımladığı her şeyi iki-üç harfli isimlere çevirir, Dart VM'in kendi isimleri kalır; tanımlayıcıların en az %10'u bu kadar kısaysa snapshot geçer. Dart SDK'nın `gen_snapshot`'ıyla iki şekilde derlenmiş bir programla doğrulandı: bayraksız %1, bayrakla %31 (strip edilmemiş) ve %37 (strip edilmiş). 200'den az tanımlayıcı karar değil, nottur.
- **WebAssembly**: sadece custom section'lar — `.debug_*` (DWARF), `name` (fonksiyon isimleri) ve `sourceMappingURL`; kodun kendisi değerlendirilmez.
- **Hermes'li React Native**: işaretlenmez, not düşülür. Hermes bytecode disassemble edilebilir (hermes-dec, hbctool), ama ne kadar bilgi verdiği bundle'ın önce minify edilip edilmediğine bağlı ve bu henüz ölçülmüyor.

## Hızlı başlangıç

```json
{
  "mcpServers": {
    "guardbee-reverse-shield": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-reverse-shield"]
    }
  }
}
```

Sonra agent'ına sor: *"`./release/MyApp.app`'i tersine mühendislikle açmak ne kadar kolay? Build ayarlarında düzeltebildiklerini düzelt."*

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan "/Applications/My App.app" --format=json
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield scan ./build/MyApp.ipa
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply   # önce gözden geçir: suggest . aynısını metin olarak basar
```

## Tool'lar

| Tool | Amaç |
|---|---|
| `scan_artifact` | Bir dosya ya da dizini tarar: APK, AAB, IPA, iOS ya da macOS `.app`, Electron klasörü, `app.asar`, JAR, ELF/Mach-O/PE/.NET binary, JS bundle, source map ya da build çıktı klasörü (Unity ve Python build'leri dahil). İsteğe bağlı `ignore` ve `baseline` |
| `suggest_fixes` | Projenin build config'ini (Vite, webpack, Next.js, Angular, CRA, Android Gradle ve manifest, React Native, electron-builder / Forge, .NET proje dosyaları, Flutter) okur ve değişiklikleri unified diff olarak döndürür. Dosya yazmaz |
| `scan_url` | Canlı bir sayfayı çeker, aynı siteye ait bundle'ları kontrol eder, `sourceMappingURL`'i takip eder ve `<bundle>.map`'i dener (üçüncü taraf script'ler çekilmez) |
| `list_checks` | Her bulgunun neyi ele verdiği ve nasıl düzeltileceğiyle kontrol kataloğu |

Dizinler `dist/`, `build/` ve `out/` dahil yürünür (amaç zaten bu); `node_modules`, VCS ve cache klasörleri atlanır. İçeride bulunan bir macOS `.app` ya da Electron klasörü tek birim olarak taranır: fuse'ları, ASAR'ı ve kendi executable'ı; paketlenmiş üçüncü taraf framework'ler değil.

`guardbee.yml`:

```yaml
reverse-shield:
  fail-on: high
  max-files: 5000
  baseline: .reverse-shield-baseline.json
  exclude:
    - "vendor/"
  ignore:                       # kabul edilen bulgular: kural id'si ya da kural:yol-parçası
    - bundle_secret:firebase-config.js
```

## CI ve baseline

Mevcut sürümün neyi açık bıraktığını kaydet, sonra CI sadece bir değişikliğin eklediklerinde başarısız olsun:

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --update-baseline          # .reverse-shield-baseline.json yazar
npx @guardbee/mcp-reverse-shield scan ./dist --baseline=.reverse-shield-baseline.json --fail-on=high
# Compared to baseline (grade C → D): 1 new, 2 fixed, 4 unchanged
```

Bulgular kontrol ve konuma göre eşleştirilir; bundler hash'leri (`index-BvL4J5f8.js`, `7321-dd7cb90a7de65945.js`) normalize edildiği için yeniden build almak eski bulguları yeni göstermez. SARIF sonuçları `baselineState` (`new` / `unchanged`) taşır.

Repoda tarayan, SARIF yükleyen, job özeti yazan ve `grade` / `new-findings` çıktıları veren bir composite action var:

```yaml
- uses: GuardBee/guardbee-mcp/.github/actions/reverse-shield@main
  with:
    target: dist
    fail-on: high
    baseline: .reverse-shield-baseline.json
```

## Sınırlar

- Obfuscation kontrol akışından değil isimlerden değerlendirilir: sadece yeniden adlandıran bir build geçer; string şifreleme ya da control-flow flattening ölçülmez.
- Web kontrolleri gönderileni inceler; bir anahtarın herkese açık olmak üzere tasarlanıp tasarlanmadığını bilemez (Firebase web anahtarları gibi bazıları sunucu tarafında kısıtlanır). Döndür ya da kısıtla, sonra bir `ignore` girdisiyle kabul et (`bundle_secret:firebase-config.js`).
- String'ler dex ve kaynak tablolarından yapılarına göre, diğer binary'lerden yazdırılabilir dizi olarak okunur; string sabitlerine bölünmüş, şifrelenmiş ya da çalışma anında birleştirilen bir anahtar bulunmaz (amaç da budur, ama tersine mühendisi yalnızca yavaşlatır).
- Native sertleştirme kontrolleri (PIE/NX/RELRO/canary) tersine mühendislikten çok exploit önleme sinyalidir; bu yüzden low/medium raporlanır.
- App Store IPA'ları dağıtımda FairPlay ile şifrelenir; tarayıcı senin dışa aktardığın IPA'yı okur (development, ad hoc ya da Apple şifrelemeden önceki App Store export'u), ki jailbreak'li bir cihazdan da aynısı elde edilir.
- `suggest_fixes` her config'in yaygın biçimlerini düzenler; alışılmadık yapılar (hesaplanan webpack config'leri, Gradle convention plugin'leri) diff almaz, Forge ve Flutter için patch yerine talimat verilir. Uygulamadan önce mutlaka gözden geçir.

## Lisans

MIT
