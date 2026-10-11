# @guardbee/mcp-audit-gap-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft MCP-Server-Code auf OWASP MCP08:2025 (fehlendes Audit und Telemetrie): Tool-Aufrufe ohne Logging, rohe Argumente und Ergebnisse im Log, deaktivierte Audit-Sinks und still verschluckte Fehler.

## Installation

```bash
npx -y @guardbee/mcp-audit-gap-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "audit-gap-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-audit-gap-auditor"
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
npx @guardbee/mcp-audit-gap-auditor --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
