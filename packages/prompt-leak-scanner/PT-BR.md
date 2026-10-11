# @guardbee/mcp-prompt-leak-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Servidor MCP e proxy reverso que pega credenciais e dados pessoais (chaves de API, TC Kimlik No, cartões de crédito, IBANs) em prompts enviados a LLMs antes que saiam da sua aplicação.

## Instalação

```bash
npx -y @guardbee/mcp-prompt-leak-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-leak-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-leak-scanner"
      ]
    }
  }
}
```

## Ferramentas MCP

`scan_text`, `scan_messages`, `scan_file`, `scan_directory`, `list_patterns`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-prompt-leak-scanner --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
