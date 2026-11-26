# @guardbee/mcp-reverse-shield

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Servidor MCP que muestra **lo que tu app publicada regala a quien hace ingeniería inversa**. Los MCP de ingeniería inversa permiten que un agente explique una app sin código fuente hasta el nivel binario; este paquete es el lado defensivo: apúntalo a *tus propios* artefactos y reporta lo que esas herramientas (o jadx, ILSpy, Hopper, las DevTools del navegador) obtienen sin esfuerzo, con una corrección para cada hallazgo. Revisa bundles web y sitios en producción (source maps, secretos), Electron (fuses, ASAR), Android APK/AAB, iOS IPA, Unity, PyInstaller, Java, Flutter, binarios nativos (ELF, Mach-O, PE) y .NET. Todo salvo `scan_url` funciona en local y sin conexión. Cada resultado lleva una nota de A a F.

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Instalación

```json
{
  "mcpServers": {
    "guardbee-reverse-shield": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-reverse-shield"]
    }
  }
}
```

## Herramientas MCP

`scan_artifact`, `suggest_fixes`, `scan_url`, `list_checks`

Los detalles están en [README.md](README.md).

## Uso

```bash
npx @guardbee/mcp-reverse-shield scan ./dist --fail-on=high
npx @guardbee/mcp-reverse-shield scan ./app/build/outputs/apk/release/app-release.apk
npx @guardbee/mcp-reverse-shield scan https://app.example.com --format=sarif > reverse-shield.sarif
npx @guardbee/mcp-reverse-shield suggest . --format=patch | git apply
```

## Límites

La ofuscación se mide solo por los nombres, no por el flujo de control. Las comprobaciones web solo ven lo que se publica; no pueden saber si una clave debe ser pública (por ejemplo, una clave web de Firebase restringida). `suggest_fixes` cubre las formas habituales de configuración: revisa los diffs antes de aplicarlos.

Los detalles están en [README.md](README.md).

## Licencia

MIT

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
