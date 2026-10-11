# @guardbee/mcp-threat-rules

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Ponte MCP da GuardBee para o Agent Threat Rules (ATR): avalia eventos de agentes/MCP com o padrão aberto de detecção estilo Sigma para prompt injection, tool poisoning, exfiltração de contexto e ataques MCP.

## Instalação

```bash
npx -y @guardbee/mcp-threat-rules
```

Claude Desktop:

```json
{
  "mcpServers": {
    "threat-rules": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-threat-rules"
      ]
    }
  }
}
```

## Ferramentas MCP

`evaluate_text`, `evaluate_file`, `evaluate_event`, `list_rules`, `rule_stats`, `explain_bridge`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-threat-rules --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
