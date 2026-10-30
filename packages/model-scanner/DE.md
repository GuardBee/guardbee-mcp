# @guardbee/mcp-model-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | **🇩🇪 Deutsch**

> Dies ist eine kurze Zusammenfassung. Die vollständige Dokumentation (Englisch) steht in [README.md](README.md).

Prüft ML-Modelldateien (PyTorch, pickle, joblib, dill, NumPy, safetensors, Keras/H5, ONNX, GGUF, TensorFlow) und Hugging-Face-Repos auf Supply-Chain-Risiken: bösartige Pickle-Gadgets, getarnte safetensors-Header, RCE über Keras-Lambda-Layer Path Traversal bei externen ONNX-Daten, Chat-Template-Injection in GGUF und TensorFlow-Ops, die Dateien lesen oder schreiben.

## Installation

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

## MCP-Tools

`scan_file`, `scan_directory`, `scan_hf_repo`, `list_patterns`

Details zu jedem Tool stehen in [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-model-scanner --help
```

> Telemetrie ist standardmäßig **aus**. Mit `GUARDBEE_TELEMETRY=1` werden Server, Tool, Erfolg, Dauer und kurze Parameterwerte wie ein Dateipfad gesendet; längere Strings und Felder wie `content`, `token` oder `password` werden durch einen Platzhalter ersetzt. Siehe [`@guardbee/mcp-telemetry`](../telemetry/DE.md).

## Lizenz

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Fragen, Ideen oder ein Fehlalarm? Starte eine Diskussion in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) oder [öffne ein Issue](https://github.com/GuardBee/guardbee-mcp/issues). Wenn GuardBee dir hilft, hilft ein ⭐ für [das Repository](https://github.com/GuardBee/guardbee-mcp) anderen, es zu finden.
