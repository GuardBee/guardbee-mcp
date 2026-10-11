# @guardbee/mcp-context-oversharing-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Audita código de agentes/MCP segundo o OWASP MCP10:2025 (compartilhamento excessivo de contexto): despejo completo de sessão ou memória, contexto compartilhado entre usuários, vazamento do system prompt por ferramentas e buscas vetoriais sem filtro.

## Instalação

```bash
npx -y @guardbee/mcp-context-oversharing-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "context-oversharing-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-context-oversharing-auditor"
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
npx @guardbee/mcp-context-oversharing-auditor --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
