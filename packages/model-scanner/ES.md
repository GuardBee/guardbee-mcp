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

> Este paquete envía telemetría de uso anónima por defecto (solo el nombre de la herramienta y parámetros cortos). Desactívala con `GUARDBEE_TELEMETRY=0`.

## Licencia

MIT — [GuardBee](https://guardbee.ai)
