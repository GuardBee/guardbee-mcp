# @guardbee/mcp-a2a-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

[![Listed on AgentHub](https://myagenthub.cn/badge/io.github.4hmetuyar/a2a-auditor)](https://myagenthub.cn/p/io.github.4hmetuyar/a2a-auditor)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Analiza código que implementa el protocolo Agent2Agent (A2A) en busca de webhooks de notificación sin autenticación (SSRF), Agent Cards sin requisito de autenticación y credenciales incrustadas en Agent Cards públicos.

## Instalación

```bash
npx -y @guardbee/mcp-a2a-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "a2a-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-a2a-auditor"
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
npx @guardbee/mcp-a2a-auditor --help
```

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
