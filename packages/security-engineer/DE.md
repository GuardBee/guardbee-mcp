# @guardbee/mcp-security-engineer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Behebt Funde des **GuardBee AI Security Engineer** in Ihrem eigenen Repository mit Ihrem Coding-Agenten (Claude Code, Cursor, VS Code) und prüft die Korrektur anschließend auf der Live-Site. GuardBee findet und erklärt das Problem und schlägt einen Fix für Ihre Plattform vor (Next.js, Express, Nginx, Apache, Cloudflare). Ihr Agent ändert das Repository, Sie genehmigen es – GuardBee bearbeitet nie selbst Code oder Server. Benötigt einen API-Schlüssel mit den Scopes `remediations.read` und `remediations.write` (GuardBee → Developers → API keys).

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Installation

```bash
claude mcp add guardbee-security-engineer -e GUARDBEE_API_KEY=gb_... -- npx -y @guardbee/mcp-security-engineer
```

## MCP-Tools

`list_assessments`, `get_assessment`, `detect_stack`, `get_fix`, `report_applied`, `verify_fix`

Details stehen in [README.md](README.md).

## Lizenz

MIT

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
