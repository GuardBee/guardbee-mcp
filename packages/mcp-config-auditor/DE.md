# @guardbee/mcp-config-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft installierte MCP-Client-Konfigurationen (Cursor, Claude Desktop, Windsurf, VS Code) und SKILL.md-Dateien von Agenten: nicht gepinnte Pakete, Secrets, Wildcard-Auto-Approve, Remotes ohne Authentifizierung, Typosquats und Shadow MCP (OWASP MCP09) gegen die Allowlist der Organisation.

## Installation

```bash
npx -y @guardbee/mcp-config-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-config-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-config-auditor"
      ]
    }
  }
}
```

## MCP-Tools

`scan_config_text`, `scan_file`, `scan_skill_text`, `scan_directory`, `scan_inventory`, `discover_shadow_mcp`, `list_host_config_paths`, `list_patterns`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-config-auditor --help
```

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
