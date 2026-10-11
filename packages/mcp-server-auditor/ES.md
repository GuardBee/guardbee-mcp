# @guardbee/mcp-server-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Audita las definiciones de herramientas de otros servidores MCP: nombres que indican agencia excesiva, shell/eval/SQL/SSRF alimentados con entrada sin validar, esquemas demasiado permisivos, secretos en el código y CORS con comodín.

## Instalación

```bash
npx -y @guardbee/mcp-server-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-server-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-server-auditor"
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
npx @guardbee/mcp-server-auditor --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
