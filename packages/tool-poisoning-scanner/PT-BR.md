# @guardbee/mcp-tool-poisoning-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Analisa as definições de ferramentas de outros servidores MCP em busca de tool poisoning (instruções escondidas na descrição, lidas pelo LLM como contexto confiável) e de 'confused deputy': ferramentas que prometem só leitura mas executam shell ou gravam arquivos.

## Instalação

```bash
npx -y @guardbee/mcp-tool-poisoning-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "tool-poisoning-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-tool-poisoning-scanner"
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
npx @guardbee/mcp-tool-poisoning-scanner --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
