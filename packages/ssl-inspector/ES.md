# @guardbee/mcp-ssl-inspector

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Inspecciona certificados TLS, cipher suites y protocolos de cualquier dominio. Handshakes adicionales muestran lo que el servidor aún acepta: TLS 1.0/1.1, intercambio de claves RSA, DH y cifrados débiles.

## Instalación

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

## Herramientas MCP

`inspect_ssl`, `inspect_ssl_bulk`, `check_cert_expiry`, `get_cert_info`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-ssl-inspector --help
```

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
