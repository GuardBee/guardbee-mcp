# @guardbee/mcp-ssl-inspector

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft TLS-Zertifikate, Cipher Suites und Protokolle jeder Domain. Zusätzliche Handshakes zeigen, was der Server noch akzeptiert: TLS 1.0/1.1, RSA-Schlüsselaustausch, schwaches DH und schwache Cipher.

## Installation

```bash
npx -y @guardbee/mcp-ssl-inspector
```

Claude Desktop:

```json
{
  "mcpServers": {
    "ssl-inspector": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-ssl-inspector"
      ]
    }
  }
}
```

## MCP-Tools

`inspect_ssl`, `inspect_ssl_bulk`, `check_cert_expiry`, `get_cert_info`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-ssl-inspector --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
