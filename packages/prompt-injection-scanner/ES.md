# @guardbee/mcp-prompt-injection-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Encuentra prompt injection indirecta en documentos, páginas extraídas y contenido de RAG: frases que anulan instrucciones, roles falsos de plantilla de chat, texto oculto, contenido dirigido a la IA y intentos de exfiltrar datos.

## Instalación

```bash
npx -y @guardbee/mcp-prompt-injection-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-injection-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-injection-scanner"
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
npx @guardbee/mcp-prompt-injection-scanner --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
