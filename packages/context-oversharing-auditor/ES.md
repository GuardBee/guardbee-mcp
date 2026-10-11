# @guardbee/mcp-context-oversharing-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Audita código de agentes/MCP según OWASP MCP10:2025 (exceso de contexto compartido): volcado completo de sesión o memoria, contexto compartido entre usuarios, fuga del system prompt por herramientas y búsquedas vectoriales sin filtro.

## Instalación

```bash
npx -y @guardbee/mcp-context-oversharing-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "context-oversharing-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-context-oversharing-auditor"
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
npx @guardbee/mcp-context-oversharing-auditor --help
```

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
