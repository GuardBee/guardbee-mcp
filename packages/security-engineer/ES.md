# @guardbee/mcp-security-engineer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Corrige los hallazgos del **GuardBee AI Security Engineer** en tu propio repositorio con tu agente de código (Claude Code, Cursor, VS Code) y luego verifica la corrección en el sitio en producción. GuardBee encuentra y explica el problema y propone una corrección para tu plataforma (Next.js, Express, Nginx, Apache, Cloudflare). Tu agente hace el cambio y tú lo apruebas: GuardBee nunca edita tu código ni tus servidores. Requiere una clave de API con los scopes `remediations.read` y `remediations.write` (GuardBee → Developers → API keys).

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Instalación

```bash
claude mcp add guardbee-security-engineer -e GUARDBEE_API_KEY=gb_... -- npx -y @guardbee/mcp-security-engineer
```

## Herramientas MCP

`list_assessments`, `get_assessment`, `detect_stack`, `get_fix`, `report_applied`, `verify_fix`

Los detalles están en [README.md](README.md).

## Licencia

MIT

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
