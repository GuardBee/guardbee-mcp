# @guardbee/mcp-document-scanner

[🇬🇧 English](README.md) | **🇹🇷 Türkçe**

PDF'lerde, ekran görüntülerinde ve taranmış belgelerde **kişisel veri ve credential** arayan bir MCP sunucusu ve CLI — belgeler bir LLM'e verilmeden önce. Proxy'deki veya DLP'deki metin kontrolleri bir PDF ekini ya da görseli okunamayan bir blob olarak görür; bu paket onu okur: önce PDF'in metin katmanı, metni olmayan sayfalar ve görseller için OCR (Türkçe ve İngilizce).

> Bu paket varsayılan olarak kullanım telemetrisi gönderir (tool adı + kısa parametreler; belge içeriği ve bulgular asla gönderilmez — bkz. [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Kapatmak için `GUARDBEE_TELEMETRY=0`.

## Kurulum

```bash
npx -y @guardbee/mcp-document-scanner scan ./sozlesmeler            # yalnızca metin katmanı
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas  # OCR ile
```

OCR isteğe bağlıdır: `tesseract.js` görselleri okur, `@napi-rs/canvas` (hazır derlenmiş, derleyici gerekmez) taranmış PDF sayfalarını OCR için görüntüye çevirir. Bunlar yoksa tarayıcı yine tüm PDF metin katmanlarını okur ve okuyamadığı sayfaları/görselleri söyler. Tesseract `tur` ve `eng` dil verisini (~10 MB) ilk kullanımda `~/.cache/guardbee/tessdata` altına indirir — çalışma klasörüne asla. İnternetsiz ortamda `<dil>.traineddata` dosyalarını bir klasöre koyup `--lang-path` ile verin.

## Tespit edilenler

T.C. kimlik no, VKN, IBAN, kart (checksum doğrulamalı), pasaport, SGK, MERSİS, doğum tarihi, adres (etiketle), e-posta, KEP, telefon ve 22+ credential formatı; isteğe bağlı IP, MAC ve plaka (`--include`). Bulgularda değerin yalnızca ilk ve son karakterleri gösterilir.

## MCP tool'ları

`scan_document` (dosya veya klasör), `scan_base64` (base64 olarak verilen belge), `list_detectors`.

## CLI

```bash
guardbee-document-scanner scan <dosya|klasör> [--format=text|json|sarif] [--fail-on=...] [--no-ocr] [--lang=tur,eng] [--lang-path=<klasör>] [--cache-path=<klasör>]
```

## Security proxy ile

[`@guardbee/mcp-security-proxy`](../security-proxy) `interceptors.documents` için bu paketi kullanır: tool sonuçlarındaki görseller, gömülü PDF'ler ve resource blob'ları model görmeden taranır; kişisel veri veya credential içeren belge tutulur (`block`) veya loglanır (`warn`).

## Lisans

MIT
