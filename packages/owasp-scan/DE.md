# @guardbee/mcp-owasp-scan

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Einheitlicher Scanner für die OWASP MCP Top 10: ein CLI/MCP führt die GuardBee-Auditoren gegen einen Pfad oder ein laufendes tools/list aus, ordnet Funde MCP01–MCP10 zu und vergibt Noten von A bis F.

## Installation

```bash
npx -y @guardbee/mcp-owasp-scan
```

Claude Desktop:

```json
{
  "mcpServers": {
    "owasp-scan": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-owasp-scan"
      ]
    }
  }
}
```

## MCP-Tools

`owasp_scan_path`, `owasp_scan_live`, `owasp_scan_catalog`, `list_owasp_coverage`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-owasp-scan --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
