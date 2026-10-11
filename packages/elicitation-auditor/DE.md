# @guardbee/mcp-elicitation-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft MCP-Server-Code auf unsichere Elicitation-Muster: Formulare, die Secrets abfragen, URL-Modus direkt auf den Authorize-Endpoint eines Dritten und Zugangsdaten oder personenbezogene Daten in der URL.

## Installation

```bash
npx -y @guardbee/mcp-elicitation-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "elicitation-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-elicitation-auditor"
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
npx @guardbee/mcp-elicitation-auditor --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
