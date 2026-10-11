# @guardbee/mcp-elicitation-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Analisa código de servidores MCP em busca de padrões inseguros de elicitation: formulários pedindo segredos, modo URL apontando direto para o endpoint de autorização de terceiros e credenciais ou dados pessoais na URL.

## Instalação

```bash
npx -y @guardbee/mcp-elicitation-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "elicitation-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-elicitation-auditor"
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
npx @guardbee/mcp-elicitation-auditor --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
