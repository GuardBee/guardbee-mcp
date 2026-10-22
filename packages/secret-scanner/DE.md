# @guardbee/mcp-secret-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Findet offengelegte Secrets, API-Keys und Zugangsdaten in Dateien, Verzeichnissen, der Git-Historie und Transkripten von Coding-Agents (76 Regeln, Entropie-Erkennung, Baselines und Live-Prüfung im CLI).

## Installation

```bash
npx -y @guardbee/mcp-secret-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "secret-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-secret-scanner"
      ]
    }
  }
}
```

## MCP-Tools

`scan_text`, `scan_file`, `scan_directory`, `scan_git`, `scan_agent_history`, `list_patterns`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-secret-scanner --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
