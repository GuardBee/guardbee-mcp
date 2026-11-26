# @guardbee/mcp-document-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

MCP-Server und CLI, der **personenbezogene Daten und Zugangsdaten in Dokumenten** findet – PDFs, Screenshots, gescannte Seiten –, bevor sie an ein LLM gehen. Zuerst wird die Textebene des PDFs gelesen, für Bilder und Seiten ohne Text folgt OCR (Türkisch und Englisch). Erkannt werden u. a. TC-Kimlik-Nr., VKN, IBAN, Karten (mit Prüfsumme), Pass, SGK, MERSİS, Geburtsdatum, Adresse, E-Mail, KEP, Telefon und über 22 Credential-Formate. Funde zeigen nur das erste und letzte Zeichen.

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Installation

```bash
npx -y @guardbee/mcp-document-scanner scan ./contracts
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas   # + OCR
```

## MCP-Tools

`scan_document`, `scan_base64`, `list_detectors`

Details stehen in [README.md](README.md).

## Verwendung

```bash
guardbee-document-scanner scan <file|folder> [--format=text|json|sarif] [--fail-on=...] [--no-ocr] [--lang=tur,eng]
```

In [`@guardbee/mcp-security-proxy`](../security-proxy) nutzt `interceptors.documents` dieses Paket: Bilder und eingebettete PDFs in Tool-Ergebnissen werden gescannt, bevor das Modell sie sieht.

## Lizenz

MIT

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
