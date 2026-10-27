# @guardbee/mcp-config-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Audita configuraciones de clientes MCP instaladas (Cursor, Claude Desktop, Windsurf, VS Code) y archivos SKILL.md de agentes: paquetes sin versión fija, secretos, aprobación automática con comodín, remotos sin autenticación, typosquats y Shadow MCP (OWASP MCP09) frente a la lista permitida de la organización.

## Instalación

```bash
npx -y @guardbee/mcp-config-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-config-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-config-auditor"
      ]
    }
  }
}
```

## Herramientas MCP

`scan_config_text`, `scan_file`, `scan_skill_text`, `scan_directory`, `scan_inventory`, `discover_shadow_mcp`, `list_host_config_paths`, `list_patterns`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-config-auditor --help
```

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
