# @guardbee/mcp-prompt-injection-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Encontra prompt injection indireta em documentos, páginas raspadas e conteúdo de RAG: frases que substituem instruções, papéis falsos de template de chat, texto oculto, conteúdo que fala direto com a IA e tentativas de exfiltração de dados.

## Instalação

```bash
npx -y @guardbee/mcp-prompt-injection-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-injection-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-injection-scanner"
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
npx @guardbee/mcp-prompt-injection-scanner --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
