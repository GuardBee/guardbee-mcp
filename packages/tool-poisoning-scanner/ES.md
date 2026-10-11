# @guardbee/mcp-tool-poisoning-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Analiza las definiciones de herramientas de otros servidores MCP en busca de tool poisoning (instrucciones ocultas en la descripción, que el LLM lee como contexto de confianza) y de 'confused deputy': herramientas que prometen solo lectura pero ejecutan shell o escriben archivos.

## Instalación

```bash
npx -y @guardbee/mcp-tool-poisoning-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "tool-poisoning-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-tool-poisoning-scanner"
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
npx @guardbee/mcp-tool-poisoning-scanner --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
