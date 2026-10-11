# @guardbee/mcp-memory-poisoning-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Findet Memory-Poisoning-Risiken im Agent-Code: nicht vertrauenswürdige Eingaben, die in persistenten, sitzungsübergreifenden Speicher (MemGPT-artig oder ein Vector Store als Langzeitwissen) geschrieben und später als vertrauenswürdiger Kontext abgerufen werden.

## Installation

```bash
npx -y @guardbee/mcp-memory-poisoning-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "memory-poisoning-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-memory-poisoning-scanner"
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
npx @guardbee/mcp-memory-poisoning-scanner --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
