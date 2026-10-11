# @guardbee/mcp-ai-code-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Findet unsichere LLM/KI-Integrationen im Code: im Client offengelegte API-Keys, unsicherer Umgang mit Modellausgaben, zu weitreichende Agent-Berechtigungen und personenbezogene Daten an Dritt-LLMs.

## Installation

```bash
npx -y @guardbee/mcp-ai-code-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "ai-code-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-ai-code-scanner"
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
npx @guardbee/mcp-ai-code-scanner --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
