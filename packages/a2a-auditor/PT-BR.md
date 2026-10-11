# @guardbee/mcp-a2a-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![Listed on AgentHub](https://myagenthub.cn/badge/io.github.4hmetuyar/a2a-auditor)](https://myagenthub.cn/p/io.github.4hmetuyar/a2a-auditor)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Analisa código que implementa o protocolo Agent2Agent (A2A) em busca de webhooks de notificação sem autenticação (SSRF), Agent Cards sem exigência de autenticação e credenciais embutidas em Agent Cards públicos.

## Instalação

```bash
npx -y @guardbee/mcp-a2a-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "a2a-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-a2a-auditor"
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
npx @guardbee/mcp-a2a-auditor --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
