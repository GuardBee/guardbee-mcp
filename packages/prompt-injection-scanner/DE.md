# @guardbee/mcp-prompt-injection-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Findet indirekte Prompt Injection in Dokumenten, gescrapten Seiten und RAG-Inhalten: Anweisungs-Overrides, gefälschte Chat-Template-Rollen, versteckten Text, direkte Ansprache der KI und Versuche, Daten abzuziehen.

## Installation

```bash
npx -y @guardbee/mcp-prompt-injection-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-injection-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-injection-scanner"
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
npx @guardbee/mcp-prompt-injection-scanner --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
