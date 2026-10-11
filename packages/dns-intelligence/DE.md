# @guardbee/mcp-dns-intelligence

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Ermittelt DNS-Einträge und findet Fehlkonfigurationen, Lücken bei der E-Mail-Sicherheit (SPF/DMARC) und verwaiste Subdomains, die übernommen werden können.

## Installation

```bash
npx -y @guardbee/mcp-dns-intelligence
```

Claude Desktop:

```json
{
  "mcpServers": {
    "dns-intelligence": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-dns-intelligence"
      ]
    }
  }
}
```

## MCP-Tools

`enumerate_dns`, `enumerate_subdomains`, `check_email_security`, `lookup_dns`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-dns-intelligence --help
```

> Dieses Paket sendet standardmäßig anonyme Nutzungstelemetrie (nur Tool-Name und kurze Parameter). Abschalten mit `GUARDBEE_TELEMETRY=0`.

## Lizenz

MIT — [GuardBee](https://guardbee.ai)
