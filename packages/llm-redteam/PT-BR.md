# @guardbee/mcp-llm-redteam

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Faz red teaming de um endpoint LLM ou chatbot em produção com sondas de jailbreak, extração e ofuscação baseadas em canários, para ver se técnicas conhecidas furam as proteções.

## Instalação

```bash
npx -y @guardbee/mcp-llm-redteam
```

Claude Desktop:

```json
{
  "mcpServers": {
    "llm-redteam": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-llm-redteam"
      ]
    }
  }
}
```

## Ferramentas MCP

`list_probes`, `run_probe_suite`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-llm-redteam --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
