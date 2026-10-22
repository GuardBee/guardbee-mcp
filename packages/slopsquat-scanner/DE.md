# @guardbee/mcp-slopsquat-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Gleicht jede Abhängigkeit aus package.json, requirements.txt und pyproject.toml mit der echten npm/PyPI-Registry ab und meldet Namen, die es nicht gibt (von LLMs halluzinierte Abhängigkeiten, die ein Angreifer vorab registrieren kann — Slopsquatting), sowie sehr neu veröffentlichte Namen.

## Installation

```bash
npx -y @guardbee/mcp-slopsquat-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "slopsquat-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-slopsquat-scanner"
      ]
    }
  }
}
```

## MCP-Tools

`scan_npm`, `scan_pip`, `check_package`, `scan_directory`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-slopsquat-scanner --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
