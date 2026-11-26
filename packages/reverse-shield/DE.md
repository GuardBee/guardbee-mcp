# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

MCP-Server, der zeigt, **was Ihre veröffentlichte App Reverse Engineers kostenlos überlässt**. Reverse-Engineering-MCPs lassen einen Agenten eine App ohne Quellcode bis auf Binärebene erklären; dieses Paket ist die Gegenseite: Richten Sie es auf *Ihre eigenen* Build-Artefakte, und es meldet, was solche Werkzeuge (oder jadx, ILSpy, Hopper, Browser-DevTools) mühelos erhalten – mit einer Korrektur für jeden Fund. Geprüft werden Web-Bundles und Live-Sites (Source Maps, Secrets), Electron (Fuses, ASAR), Android APK/AAB, iOS IPA, Unity, PyInstaller, Java, Flutter, native Binaries (ELF, Mach-O, PE) und .NET. Alles außer `scan_url` läuft lokal und offline. Jedes Ergebnis hat eine Note von A bis F.

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Installation

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

## MCP-Tools

`scan_artifact`, `suggest_fixes`, `scan_url`, `list_checks`

Details stehen in [README.md](README.md).

## Verwendung

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply
```

## Grenzen

Verschleierung wird nur an Namen gemessen, nicht am Kontrollfluss. Web-Prüfungen sehen nur, was ausgeliefert wird; ob ein Schlüssel öffentlich sein darf (z. B. ein eingeschränkter Firebase-Web-Key), können sie nicht beurteilen. `suggest_fixes` deckt die üblichen Konfigurationsformen ab – Diffs vor dem Anwenden prüfen.

Details stehen in [README.md](README.md).

## Lizenz

MIT

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
