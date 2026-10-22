# @guardbee/mcp-oauth-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft den Autorisierungscode eines MCP-Servers auf die OAuth-2.1-Probleme aus den Sicherheitshinweisen der MCP-Spezifikation: Token-Passthrough, fehlende Audience-Prüfung, SSRF über Discovery, fehlendes PKCE, lockere redirect_uri-Prüfung und hartkodierte Client Secrets.

## Installation

```bash
npx -y @guardbee/mcp-oauth-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "oauth-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-oauth-auditor"
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
npx @guardbee/mcp-oauth-auditor --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
