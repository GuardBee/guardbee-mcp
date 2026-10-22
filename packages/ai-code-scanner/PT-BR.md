# @guardbee/mcp-ai-code-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Encontra padrões inseguros de integração com LLM/IA no código: chaves de API expostas no cliente, uso inseguro da saída do modelo, permissões excessivas de agentes e dados pessoais enviados a LLMs de terceiros.

## Instalação

```bash
npx -y @guardbee/mcp-ai-code-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "ai-code-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-ai-code-scanner"
      ]
    }
  }
}
```

## Ferramentas MCP

`scan_text`, `scan_file`, `scan_directory`, `list_patterns`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-ai-code-scanner --help
```

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
