# @guardbee/mcp-compliance-checker

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft Websites über die GuardBee-API auf Konformität mit KVKK, DSGVO (GDPR) und CCPA.

## Installation

```bash
npx -y @guardbee/mcp-compliance-checker
```

Claude Desktop:

```json
{
  "mcpServers": {
    "compliance-checker": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-compliance-checker"
      ]
    }
  }
}
```

## MCP-Tools

`check_compliance`, `get_compliance_findings`, `analyze_privacy_policy`, `list_requirements`, `compare_frameworks`

Details zu jedem Tool stehen in [README.md](README.md).

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
