# @guardbee/mcp-dependency-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Contrasta manifiestos de npm y pip con la base de datos OSV e informa de CVE conocidos. Las consultas de un solo paquete también cubren PyPI, crates.io, Maven, Go y RubyGems.

## Instalación

```bash
npx -y @guardbee/mcp-dependency-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "dependency-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-dependency-auditor"
      ]
    }
  }
}
```

## Herramientas MCP

`audit_npm`, `audit_pip`, `audit_package`, `audit_directory`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-dependency-auditor --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
