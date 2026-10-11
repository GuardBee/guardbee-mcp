# @guardbee/mcp-rug-pull-detector

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Se conecta a otro servidor MCP (stdio o Streamable HTTP), guarda su tools/list como línea base y detecta 'rug pulls': una herramienta que cambia en silencio su descripción, esquema o anotaciones después de ser aprobada.

## Instalación

```bash
npx -y @guardbee/mcp-rug-pull-detector
```

Claude Desktop:

```json
{
  "mcpServers": {
    "rug-pull-detector": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-rug-pull-detector"
      ]
    }
  }
}
```

## Herramientas MCP

`baseline_server`, `check_server`, `list_baselines`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-rug-pull-detector --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
