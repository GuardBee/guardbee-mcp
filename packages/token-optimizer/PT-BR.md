# @guardbee/mcp-token-optimizer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Descobre o que consome tokens do Claude Code nesta máquina e interrompe: contextos grandes demais (cada mensagem reenvia o contexto inteiro), leituras de arquivos e ferramentas MCP que enchem o contexto, servidores MCP sem uso e sessões ociosas.

## Instalação

```bash
npx -y @guardbee/mcp-token-optimizer
```

Claude Desktop:

```json
{
  "mcpServers": {
    "token-optimizer": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-token-optimizer"
      ]
    }
  }
}
```

## Ferramentas MCP

`optimize_report`, `list_sessions`, `stop_sessions`, `audit_mcp_servers`, `disable_mcp_servers`, `restore_mcp_servers`, `measure_mcp_definitions`, `install_hooks`, `uninstall_hooks`, `install_statusline`, `uninstall_statusline`

Novidades: aviso quando a saída de uma ferramenta é grande demais (hook PostToolUse) e uma linha de status com o tamanho do contexto, os medidores do plano, o tempo até o reset e o alarme de uso externo (`install-statusline`).

Os detalhes de cada ferramenta estão em [README.md](README.md).

`stop_sessions`, `disable_mcp_servers` e `restore_mcp_servers` são simulações por padrão. Só a CLI do Claude Code é interrompida, nunca a sessão que executa a ferramenta (`claude --resume` a reabre), e há backup antes de cada mudança de configuração.

## CLI

```bash
npx @guardbee/mcp-token-optimizer report
```

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
