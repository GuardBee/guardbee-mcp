# @guardbee/mcp-unbounded-consumption-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Procura no código de aplicações LLM/agentes os padrões de consumo ilimitado ('denial of wallet', item 6 do OWASP LLM Top 10 2026): sem limite de tokens de saída, chamadas HTTP a LLMs sem timeout, loops de ferramentas ou retries sem limite, limites de segurança desligados e ferramentas MCP sem rate limit.

## Instalação

```bash
npx -y @guardbee/mcp-unbounded-consumption-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "unbounded-consumption-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-unbounded-consumption-auditor"
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
npx @guardbee/mcp-unbounded-consumption-auditor --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
