# @guardbee/mcp-document-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | **🇪🇸 Español** | [🇩🇪 Deutsch](DE.md)

> Este es un resumen breve. La documentación completa (en inglés) está en [README.md](README.md).

Servidor MCP y CLI que encuentra **datos personales y credenciales dentro de documentos** —PDF, capturas de pantalla, páginas escaneadas— antes de entregarlos a un LLM. Primero lee la capa de texto del PDF y, para imágenes y páginas sin texto, aplica OCR (turco e inglés). Detecta, entre otros, TC Kimlik, VKN, IBAN, tarjetas (con suma de control), pasaporte, SGK, MERSİS, fecha de nacimiento, dirección, correo, KEP, teléfono y más de 22 formatos de credenciales. Los hallazgos muestran solo el primer y el último carácter.

> La telemetría está **desactivada** por defecto. Con `GUARDBEE_TELEMETRY=1` se envían el servidor, la herramienta, el éxito, la duración y valores cortos de parámetros, como una ruta de archivo; los textos más largos y campos como `content`, `token` o `password` se sustituyen por un marcador. Consulta [`@guardbee/mcp-telemetry`](../telemetry/ES.md).

## Instalación

```bash
npx -y @guardbee/mcp-document-scanner scan ./contracts
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas   # + OCR
```

## Herramientas MCP

`scan_document`, `scan_base64`, `list_detectors`

Los detalles están en [README.md](README.md).

## Uso

```bash
guardbee-document-scanner scan <file|folder> [--format=text|json|sarif] [--fail-on=...] [--no-ocr] [--lang=tur,eng]
```

En [`@guardbee/mcp-security-proxy`](../security-proxy), `interceptors.documents` usa este paquete: las imágenes y PDF incrustados en los resultados de herramientas se analizan antes de que el modelo los vea.

## Licencia

MIT

## Comentarios

¿Preguntas, ideas o un falso positivo? Abre un hilo en [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) o [una issue](https://github.com/GuardBee/guardbee-mcp/issues). Si GuardBee te resulta útil, una ⭐ en [el repositorio](https://github.com/GuardBee/guardbee-mcp) ayuda a que otros lo encuentren.
