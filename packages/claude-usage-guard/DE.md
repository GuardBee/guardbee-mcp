# @guardbee/mcp-claude-usage-guard

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft, ob Ihre gesamte Claude-Plannutzung von Ihnen stammt. Vergleicht den kontoweiten Plan-Zähler (5 Stunden / 7 Tage), den Claude Code für /usage zwischenspeichert, über die Zeit mit den Transkripten dieses Rechners und meldet Nutzung, die lokal nicht erklärbar ist. Zusätzlich: Kontowechsel, SDK-/Skript-Nutzung Ihres Logins, Remote-Logins und Hintergrundsitzungen. Hinweis: Eigene Chats auf claude.ai, Desktop und Mobil zählen auf dieselben Limits.

## Installation

```bash
npx -y @guardbee/mcp-claude-usage-guard
```

Claude Desktop:

```json
{
  "mcpServers": {
    "claude-usage-guard": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-claude-usage-guard"
      ]
    }
  }
}
```

## MCP-Tools

`detect_foreign_usage`, `usage_report`, `account_status`, `plan_forecast`, `install_hooks`, `uninstall_hooks`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-claude-usage-guard detect
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
