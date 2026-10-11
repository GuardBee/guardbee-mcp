# @guardbee/mcp-agent-graph-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Construye un grafo de alcanzabilidad a partir de configuraciones multiagente (LangGraph, CrewAI, AutoGen/ag2) para encontrar agentes sin herramientas peligrosas propias que llegan a una por delegación o grupo (agencia excesiva transitiva).

## Instalación

```bash
npx -y @guardbee/mcp-agent-graph-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "agent-graph-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-agent-graph-auditor"
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
npx @guardbee/mcp-agent-graph-auditor --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
