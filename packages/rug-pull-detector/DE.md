# @guardbee/mcp-rug-pull-detector

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Verbindet sich mit einem anderen MCP-Server (stdio oder Streamable HTTP), speichert dessen tools/list als Baseline und erkennt „Rug Pulls“ — ein Tool, das nach der Freigabe still Beschreibung, Schema oder Annotationen ändert.

## Installation

```bash
npx -y @guardbee/mcp-rug-pull-detector
```

Claude Desktop:

```json
{
  "mcpServers": {
    "rug-pull-detector": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-rug-pull-detector"
      ]
    }
  }
}
```

## MCP-Tools

`baseline_server`, `check_server`, `list_baselines`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-rug-pull-detector --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
