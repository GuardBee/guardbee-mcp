# @guardbee/mcp-owasp-scan

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Scanner unificado do OWASP MCP Top 10: um único CLI/MCP roda os auditores GuardBee sobre um caminho ou um tools/list ao vivo, mapeia os achados para MCP01–MCP10 e dá uma nota de A a F.

## Instalação

```bash
npx -y @guardbee/mcp-owasp-scan
```

Claude Desktop:

```json
{
  "mcpServers": {
    "owasp-scan": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-owasp-scan"
      ]
    }
  }
}
```

## Ferramentas MCP

`owasp_scan_path`, `owasp_scan_live`, `owasp_scan_catalog`, `list_owasp_coverage`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-owasp-scan --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
