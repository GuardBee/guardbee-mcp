# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Las principales herramientas de seguridad de GuardBee en un solo paquete: escáner de secretos, auditor de dependencias, inspector SSL e inteligencia DNS.

## Instalación

```bash
npm install -g @guardbee/security-suite
```

## Herramientas MCP

`scan_directory`, `scan_file`, `audit_dependencies`, `inspect_ssl`, `check_dns`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/security-suite --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
