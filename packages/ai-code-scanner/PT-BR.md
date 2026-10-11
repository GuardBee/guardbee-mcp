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

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
