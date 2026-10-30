# @guardbee/mcp-model-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Analisa arquivos de modelos de ML (PyTorch, pickle, joblib, dill, NumPy, safetensors, Keras/H5, ONNX, GGUF, TensorFlow) e repos do Hugging Face em busca de riscos de cadeia de suprimentos: gadgets maliciosos em pickle, cabeçalhos safetensors disfarçados, RCE via camada Lambda do Keras path traversal em dados externos do ONNX, injeção em templates de chat GGUF e operações do TensorFlow que leem ou gravam arquivos.

## Instalação

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

## Ferramentas MCP

`scan_file`, `scan_directory`, `scan_hf_repo`, `list_patterns`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-model-scanner --help
```

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
