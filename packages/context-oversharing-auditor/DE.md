# @guardbee/mcp-context-oversharing-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft Agent-/MCP-Code auf OWASP MCP10:2025 (Context Oversharing): vollständige Sitzungs- oder Memory-Dumps, nutzerübergreifender Kontext, System-Prompt-Leaks über Tools und Vektorsuchen ohne Filter.

## Installation

```bash
npx -y @guardbee/mcp-context-oversharing-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "context-oversharing-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-context-oversharing-auditor"
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
npx @guardbee/mcp-context-oversharing-auditor --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
