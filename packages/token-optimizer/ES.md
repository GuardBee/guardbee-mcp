# @guardbee/mcp-token-optimizer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Encuentra qué consume tokens de Claude Code en esta máquina y lo detiene: contextos sobredimensionados (cada mensaje reenvía todo el contexto), lecturas de archivos y herramientas MCP que llenan el contexto, servidores MCP sin uso y sesiones inactivas.

## Instalación

```bash
npx -y @guardbee/mcp-token-optimizer
```

Claude Desktop:

```json
{
  "mcpServers": {
    "token-optimizer": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-token-optimizer"
      ]
    }
  }
}
```

## Herramientas MCP

`optimize_report`, `list_sessions`, `stop_sessions`, `audit_mcp_servers`, `disable_mcp_servers`, `restore_mcp_servers`, `measure_mcp_definitions`, `install_hooks`, `uninstall_hooks`, `install_statusline`, `uninstall_statusline`

Novedades: aviso cuando una salida de herramienta es muy grande (hook PostToolUse) y una línea de estado con el tamaño del contexto, los contadores del plan, el tiempo hasta el reinicio y la alarma de uso ajeno (`install-statusline`).

Los detalles de cada herramienta están en [README.md](README.md).

`stop_sessions`, `disable_mcp_servers` y `restore_mcp_servers` son simulaciones por defecto. Solo se detiene la CLI de Claude Code, nunca la sesión que ejecuta la herramienta (`claude --resume` la reabre), y se hace una copia de seguridad antes de cada cambio de configuración.

## CLI

```bash
npx @guardbee/mcp-token-optimizer report
```

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
