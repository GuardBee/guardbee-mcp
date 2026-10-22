# @guardbee/mcp-unbounded-consumption-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Findet im Code von LLM-/Agent-Anwendungen Muster für unbegrenzten Verbrauch („Denial of Wallet“, Platz 6 der OWASP LLM Top 10 2026): fehlende Ausgabe-Token-Limits, LLM-HTTP-Aufrufe ohne Timeout, unbegrenzte Tool- oder Retry-Schleifen, abgeschaltete Sicherheitslimits und MCP-Tools ohne Rate Limiting.

## Installation

```bash
npx -y @guardbee/mcp-unbounded-consumption-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "unbounded-consumption-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-unbounded-consumption-auditor"
      ]
    }
  }
}
```

## MCP-Tools

`scan_text`, `scan_file`, `scan_directory`, `list_patterns`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-unbounded-consumption-auditor --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
