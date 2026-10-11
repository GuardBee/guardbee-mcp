# @guardbee/mcp-audit-gap-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Audita el código de servidores MCP según OWASP MCP08:2025 (falta de auditoría y telemetría): llamadas a herramientas sin registro, argumentos y resultados en bruto en los logs, auditoría desactivada y errores silenciados.

## Instalación

```bash
npx -y @guardbee/mcp-audit-gap-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "audit-gap-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-audit-gap-auditor"
      ]
    }
  }
}
```

## Herramientas MCP

`scan_text`, `scan_file`, `scan_directory`, `list_patterns`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-audit-gap-auditor --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
