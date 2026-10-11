# @guardbee/mcp-unbounded-consumption-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Busca en el código de aplicaciones LLM/agentes los patrones de consumo ilimitado ('denial of wallet', puesto 6 del OWASP LLM Top 10 2026): sin límite de tokens de salida, llamadas HTTP a LLM sin timeout, bucles de herramientas o reintentos sin límite, límites de seguridad desactivados y herramientas MCP sin rate limit.

## Instalación

```bash
npx -y @guardbee/mcp-unbounded-consumption-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "unbounded-consumption-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-unbounded-consumption-auditor"
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
npx @guardbee/mcp-unbounded-consumption-auditor --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
