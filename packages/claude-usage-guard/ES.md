# @guardbee/mcp-claude-usage-guard

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Comprueba si todo el uso de tu plan de Claude viene de ti. Compara con el tiempo el medidor del plan de toda la cuenta (5 horas / 7 días) que Claude Code guarda para /usage con las transcripciones de esta máquina, y señala el uso que nada local explica. Además: cambios de cuenta, uso de tu sesión por SDK/scripts, inicios de sesión remotos y sesiones en segundo plano. Nota: tus propios chats en claude.ai, escritorio y móvil cuentan para los mismos límites.

## Instalación

```bash
npx -y @guardbee/mcp-claude-usage-guard
```

Claude Desktop:

```json
{
  "mcpServers": {
    "claude-usage-guard": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-claude-usage-guard"
      ]
    }
  }
}
```

## Herramientas MCP

`detect_foreign_usage`, `usage_report`, `account_status`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-claude-usage-guard detect
```

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
