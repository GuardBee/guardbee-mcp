# @guardbee/mcp-model-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Analiza archivos de modelos de ML (PyTorch, pickle, safetensors, Keras/H5, ONNX) en busca de riesgos de cadena de suministro: gadgets maliciosos en pickle, cabeceras safetensors disfrazadas, RCE mediante capas Lambda de Keras y path traversal en datos externos de ONNX.

## Instalación

```bash
npx -y @guardbee/mcp-model-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "model-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-model-scanner"
      ]
    }
  }
}
```

## Herramientas MCP

`scan_file`, `scan_directory`, `list_patterns`

Los detalles de cada herramienta están en [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-model-scanner --help
```

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Licencia

MIT — [GuardBee](https://guardbee.ai)

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
