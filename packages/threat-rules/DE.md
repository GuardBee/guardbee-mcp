# @guardbee/mcp-threat-rules

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

GuardBee-MCP-Brücke zu den Agent Threat Rules (ATR): bewertet Agent-/MCP-Ereignisse mit dem offenen, Sigma-ähnlichen Erkennungsstandard für Prompt Injection, Tool Poisoning, Kontext-Exfiltration und MCP-Angriffe.

## Installation

```bash
npx -y @guardbee/mcp-threat-rules
```

Claude Desktop:

```json
{
  "mcpServers": {
    "threat-rules": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-threat-rules"
      ]
    }
  }
}
```

## MCP-Tools

`evaluate_text`, `evaluate_file`, `evaluate_event`, `list_rules`, `rule_stats`, `explain_bridge`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-threat-rules --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
