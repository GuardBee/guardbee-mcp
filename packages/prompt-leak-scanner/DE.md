# @guardbee/mcp-prompt-leak-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

MCP-Server und Reverse Proxy, der Zugangsdaten und personenbezogene Daten (API-Keys, TC-Kimlik-Nr., Kreditkarten, IBANs) in ausgehenden LLM-Prompts abfängt, bevor sie Ihre Anwendung verlassen.

## Installation

```bash
npx -y @guardbee/mcp-prompt-leak-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-leak-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-leak-scanner"
      ]
    }
  }
}
```

## MCP-Tools

`scan_text`, `scan_messages`, `scan_file`, `scan_directory`, `list_patterns`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-prompt-leak-scanner --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
