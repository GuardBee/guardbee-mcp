# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Todas las herramientas de seguridad MCP de GuardBee en una sola instalación: un servidor MCP con las herramientas de los paquetes que elijas y una CLI que ejecuta cualquier paquete. 30 paquetes, 127 herramientas MCP.

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Instalación

```bash
npm install -g @guardbee/security-suite
```

## Herramientas MCP

`guardbee serve` ofrece por defecto el grupo **recommended** (31 herramientas): escaneo OWASP MCP Top 10 en una pasada, secretos, prompt injection, flujos tóxicos, configuraciones de clientes MCP y CVE de dependencias. Elige otros con `--tools=code,network` (grupos o ids de paquete) o `--tools=all` (127 herramientas). Los nombres llevan el prefijo del paquete: `secrets_scan_text`, `injection_scan_text`. `guardbee list` muestra paquetes y grupos.

```json
{ "mcpServers": { "guardbee": { "command": "npx", "args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended"] } } }
```

## CLI

`guardbee <id-de-paquete> <args>` ejecuta la CLI de ese paquete, por ejemplo `guardbee owasp-scan scan . --fail-on=high`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
