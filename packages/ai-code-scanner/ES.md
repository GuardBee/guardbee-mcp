# @guardbee/mcp-ai-code-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Encuentra patrones inseguros de integración con LLM/IA en el código: claves de API expuestas en el cliente, manejo inseguro de la salida del modelo, permisos excesivos de agentes y datos personales enviados a LLM de terceros.

## Instalación

```bash
npx -y @guardbee/mcp-ai-code-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "ai-code-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-ai-code-scanner"
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
npx @guardbee/mcp-ai-code-scanner --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
