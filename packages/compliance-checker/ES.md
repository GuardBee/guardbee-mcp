# @guardbee/mcp-compliance-checker

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Comprueba el cumplimiento de sitios web con KVKK, GDPR y CCPA a través de la API de GuardBee.

## Instalación

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

## Herramientas MCP

`check_compliance`, `get_compliance_findings`, `analyze_privacy_policy`, `list_requirements`, `compare_frameworks`

Los detalles de cada herramienta están en [README.md](README.md).

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
