# @guardbee/mcp-dns-intelligence

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Enumera registros DNS y detecta configuraciones incorrectas, fallos de seguridad del correo (SPF/DMARC) y subdominios colgantes que pueden ser secuestrados.

## Instalación

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

## Herramientas MCP

`enumerate_dns`, `enumerate_subdomains`, `check_email_security`, `lookup_dns`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-dns-intelligence --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
