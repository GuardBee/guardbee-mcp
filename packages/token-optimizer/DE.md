# @guardbee/mcp-token-optimizer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Findet, was auf diesem Rechner Claude-Code-Tokens verbraucht, und stoppt es: übergroße Kontexte (jede Nachricht sendet den ganzen Kontext erneut), kontextfüllende Dateilesungen und MCP-Tools, ungenutzte MCP-Server und inaktive Sitzungen.

## Installation

```bash
npx -y @guardbee/mcp-token-optimizer
```

Claude Desktop:

```json
{
  "mcpServers": {
    "token-optimizer": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-token-optimizer"
      ]
    }
  }
}
```

## MCP-Tools

`optimize_report`, `list_sessions`, `stop_sessions`, `audit_mcp_servers`, `disable_mcp_servers`, `restore_mcp_servers`

Details zu jedem Tool stehen in [README.md](README.md).

`stop_sessions`, `disable_mcp_servers` und `restore_mcp_servers` sind standardmäßig Testläufe. Gestoppt wird nur die Claude-Code-CLI, nie die Sitzung, die das Tool ausführt (`claude --resume` öffnet sie wieder); vor jeder Konfigurationsänderung wird ein Backup angelegt.

## CLI

```bash
npx @guardbee/mcp-token-optimizer report
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
