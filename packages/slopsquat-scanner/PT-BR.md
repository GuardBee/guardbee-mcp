# @guardbee/mcp-slopsquat-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Confere cada dependência de package.json, requirements.txt e pyproject.toml no registro real do npm/PyPI e aponta nomes que não existem (dependências alucinadas por LLMs que um atacante pode registrar antes — slopsquatting) e nomes publicados muito recentemente.

## Instalação

```bash
npx -y @guardbee/mcp-slopsquat-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "slopsquat-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-slopsquat-scanner"
      ]
    }
  }
}
```

## Ferramentas MCP

`scan_npm`, `scan_pip`, `check_package`, `scan_directory`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-slopsquat-scanner --help
```

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
