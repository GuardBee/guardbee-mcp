# @guardbee/mcp-secret-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Encuentra secretos, claves de API y credenciales expuestos en archivos, directorios, historial de git y transcripciones de agentes de código (76 reglas, detección por entropía, baselines y verificación en vivo en el CLI).

## Instalación

```bash
npx -y @guardbee/mcp-secret-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "secret-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-secret-scanner"
      ]
    }
  }
}
```

## Herramientas MCP

`scan_text`, `scan_file`, `scan_directory`, `scan_git`, `scan_agent_history`, `list_patterns`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-secret-scanner --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
