# @guardbee/mcp-owasp-scan

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Escáner unificado del OWASP MCP Top 10: un solo CLI/MCP ejecuta los auditores de GuardBee sobre una ruta o un tools/list en vivo, asigna los hallazgos a MCP01–MCP10 y califica de A a F.

## Instalación

```bash
npx -y @guardbee/mcp-owasp-scan
```

Claude Desktop:

```json
{
  "mcpServers": {
    "owasp-scan": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-owasp-scan"
      ]
    }
  }
}
```

## Herramientas MCP

`owasp_scan_path`, `owasp_scan_live`, `owasp_scan_catalog`, `list_owasp_coverage`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-owasp-scan --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
