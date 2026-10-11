# @guardbee/mcp-llm-redteam

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Hace red teaming de un endpoint LLM o chatbot en producción con sondas de jailbreak, extracción y ofuscación basadas en canarios, para comprobar si técnicas conocidas superan sus protecciones.

## Instalación

```bash
npx -y @guardbee/mcp-llm-redteam
```

Claude Desktop:

```json
{
  "mcpServers": {
    "llm-redteam": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-llm-redteam"
      ]
    }
  }
}
```

## Herramientas MCP

`list_probes`, `run_probe_suite`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-llm-redteam --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
