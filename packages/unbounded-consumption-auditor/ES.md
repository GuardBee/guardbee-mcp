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

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
