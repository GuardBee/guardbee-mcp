# @guardbee/mcp-toxic-flow-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Erkennt toxische Datenflüsse (Lethal Trifecta) in einem MCP-Tool-Katalog: nicht vertrauenswürdige Inhalte, sensible Daten und Exfiltration oder Zerstörung auf demselben Server.

## Installation

```bash
npx -y @guardbee/mcp-toxic-flow-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "toxic-flow-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-toxic-flow-auditor"
      ]
    }
  }
}
```

## MCP-Tools

`audit_catalog`, `scan_source`, `scan_file`, `scan_directory`, `explain_trifecta`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-toxic-flow-auditor --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
