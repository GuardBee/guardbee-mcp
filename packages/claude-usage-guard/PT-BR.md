# @guardbee/mcp-claude-usage-guard

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Verifica se todo o uso do seu plano Claude vem de você. Compara ao longo do tempo o medidor do plano da conta inteira (5 horas / 7 dias), que o Claude Code guarda para /usage, com as transcrições desta máquina, e aponta uso que nada local explica. Também verifica trocas de conta, uso do seu login por SDK/scripts, logins remotos e sessões em segundo plano. Nota: seus próprios chats no claude.ai, desktop e celular contam para os mesmos limites.

## Instalação

```bash
npx -y @guardbee/mcp-claude-usage-guard
```

Claude Desktop:

```json
{
  "mcpServers": {
    "claude-usage-guard": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-claude-usage-guard"
      ]
    }
  }
}
```

## Ferramentas MCP

`detect_foreign_usage`, `usage_report`, `account_status`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-claude-usage-guard detect
```

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
