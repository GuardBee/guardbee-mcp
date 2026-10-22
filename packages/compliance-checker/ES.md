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

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
