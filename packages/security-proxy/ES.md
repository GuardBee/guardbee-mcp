# @guardbee/mcp-security-proxy

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Gateway de seguridad MCP: varios servidores MCP detrás de una sola política, con bloqueo de flujos tóxicos (lethal trifecta), aprobaciones, enmascaramiento de datos personales, usuarios OIDC, cuotas, OpenTelemetry y registro de auditoría encadenado por hash.

## Instalación

```bash
npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop
```

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
