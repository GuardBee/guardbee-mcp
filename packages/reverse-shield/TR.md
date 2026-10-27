# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | **🇹🇷 Türkçe** | [🇨🇳 中文](ZH.md)

Yayınladığın uygulamanın bir tersine mühendise **neyi bedavaya verdiğini** söyleyen bir MCP server.

Tersine mühendislik MCP'leri artık bir agent'ın kaynak kodu olmayan bir uygulamayı (web bundle, Electron uygulaması, APK, native ya da .NET binary) alıp bir özelliğin nasıl çalıştığını binary seviyesine kadar açıklamasına izin veriyor. Bu paket madalyonun öbür yüzü: onu *kendi* build artifact'ına yönelt; böyle bir aracın (ya da jadx, ILSpy, Hopper veya tarayıcı devtools'u kullanan birinin) hiç uğraşmadan neler elde edeceğini, her biri için düzeltmesiyle birlikte raporlar.

> Telemetri varsayılan olarak **kapalıdır**. `GUARDBEE_TELEMETRY=1` ile açılırsa sunucu, tool, başarı, süre ve dosya yolu gibi kısa parametre değerleri gönderilir; daha uzun metinler ve `content`, `token`, `password` gibi alanlar yer tutucuyla değiştirilir. Bkz. [`@guardbee/mcp-telemetry`](../telemetry/TR.md).

```
Claude ──► reverse-shield ──► build artifact'ın / canlı site
              │
              ├─ web       source map'ler (paketlenmiş, inline, herkese açık), minify edilmemiş / dev bundle, anahtarlar, iç host'lar
              ├─ electron  fuse'lar (RunAsNode, --inspect, NODE_OPTIONS, ASAR integrity), açık uygulama kodu, app.asar içindeki kod
              ├─ android   debuggable, R8/ProGuard yok, imza şeması, backup, düz React Native bundle, strip edilmemiş .so
              ├─ native    debug bilgisi, semboller, get-task-allow, hardened runtime, imza, PIE/NX/RELRO/canary (ELF, Mach-O, PE)
              └─ .NET      obfuscation yok, gömülü PDB, sızan build yolları
```

`scan_url` dışında her şey yerelde ve çevrimdışı çalışır. ASAR, Electron fuse wire, ikili AndroidManifest (AXML), DEX, ELF, Mach-O (universal binary'ler ve kod imzası dahil) ve PE/.NET metadata için kendi ayrıştırıcıları var; apktool, jadx ya da binutils gerekmez.

## Neyi işaretler

| Kontrol | Önem | Hedef | Neyi ele verir |
|---|---|---|---|
| `sourcemap_embeds_source` | critical | web | `sourcesContent` ile orijinal kaynak kodun tamamı |
| `sourcemap_shipped` / `sourcemap_inline` / `sourcemap_publicly_reachable` | high | web | Orijinal dosya yolları ve yapı |
| `eval_devtool_bundle` | high | web | Her modülün yoluyla birlikte dev bundle |
| `bundle_secret` | anahtar türüne göre | web | İstemci kodunda çalışan bir kimlik bilgisi |
| `unminified_bundle` / `dev_build_framework` | medium | web | Okunabilir kod / framework'ün dev runtime'ı |
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
| `dotnet_not_obfuscated` / `dotnet_embedded_pdb` | high | .NET | Orijinal kaynağa çok yakın ILSpy/dnSpy çıktısı |

`list_checks` tüm kataloğu düzeltmeleriyle döndürür. Her sonuç bir **A–F notu** taşır: kritik bir şey (ya da birden fazla high bulgu) açıktaysa F, hiçbir şey yoksa A.

### Zor kontroller nasıl karar veriyor

- **R8/ProGuard**: her `classes*.dex`'ten sınıf tanımlayıcılarını okur ve application id altındaki (`.debug` gibi son ekler için manifest'te adı geçen bileşenlerin paketleri altındaki) sınıflara bakar. Neredeyse hiç bir-iki harfli isim olmadan onlarca açıklayıcı sınıf adı, R8'in çalışmadığı anlamına gelir.
- **.NET obfuscation**: metadata `#Strings` heap'ini okur. Bilinen obfuscator işaretleri (ConfuserEx, Dotfuscator, SmartAssembly, …) doğrudan geçer; aksi halde tanımlayıcıların en az %10'u bir-iki harfli isim, sadece rakam ya da ASCII dışı çöp karakterse assembly geçer. Bir Obfuscar build'ine (%21, geçer) ve obfuscate edilmemiş 400 NuGet assembly'sine (383'ü işaretlendi; kalan 17'si karar verilemeyecek kadar az isim içeren kaynak assembly'leri) karşı doğrulandı.
- **Private key'ler**: sadece PEM başlığından sonra base64 anahtar verisi geliyorsa raporlanır; uygulamalara gömülen kripto kütüphaneleri bu başlığı string sabiti olarak taşır.
- **Tekrarlar**: 30 chunk'taki aynı anahtar tek bulgudur ("also in 29 other files"); uzun minify edilmemiş dosya listeleri tek bulguda toplanır.

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
```

## Tool'lar

| Tool | Amaç |
|---|---|
| `scan_artifact` | Bir dosya ya da dizini tarar: APK, `.app`, Electron klasörü, `app.asar`, ELF/Mach-O/PE/.NET binary, JS bundle, source map ya da build çıktı klasörü |
| `scan_url` | Canlı bir sayfayı çeker, aynı siteye ait bundle'ları kontrol eder, `sourceMappingURL`'i takip eder ve `<bundle>.map`'i dener (üçüncü taraf script'ler çekilmez) |
| `list_checks` | Her bulgunun neyi ele verdiği ve nasıl düzeltileceğiyle kontrol kataloğu |

Dizinler `dist/`, `build/` ve `out/` dahil yürünür (amaç zaten bu); `node_modules`, VCS ve cache klasörleri atlanır. İçeride bulunan bir macOS `.app` ya da Electron klasörü tek birim olarak taranır: fuse'ları, ASAR'ı ve kendi executable'ı; paketlenmiş üçüncü taraf framework'ler değil.

`guardbee.yml`:

```yaml
reverse-shield:
  fail-on: high
  max-files: 5000
  exclude:
    - "vendor/"
```

## CI

```yaml
- run: npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high --format=sarif > reverse-shield.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: reverse-shield.sarif
```

## Sınırlar

- Obfuscation kontrol akışından değil isimlerden değerlendirilir: sadece yeniden adlandıran bir build geçer; string şifreleme ya da control-flow flattening ölçülmez.
- Web kontrolleri gönderileni inceler; bir anahtarın herkese açık olmak üzere tasarlanıp tasarlanmadığını bilemez (Firebase web anahtarları gibi bazıları sunucu tarafında kısıtlanır). Döndür ya da kısıtla, sonra yolu `exclude`'a ekle.
- Native sertleştirme kontrolleri (PIE/NX/RELRO/canary) tersine mühendislikten çok exploit önleme sinyalidir; bu yüzden low/medium raporlanır.
- iOS `.ipa` ve Android App Bundle (`.aab`) henüz açılmıyor; `.ipa` içindeki `.app`'i ya da bundle'dan üretilmiş universal APK'yı tara.

## Lisans

MIT
