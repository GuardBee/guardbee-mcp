# @guardbee/mcp-compliance-checker

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-compliance-checker.svg)](https://www.npmjs.com/package/@guardbee/mcp-compliance-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Verifica a conformidade de sites com KVKK, GDPR e CCPA pela API da GuardBee.

## Instalação

```bash
npx -y @guardbee/mcp-compliance-checker
```

Claude Desktop:

```json
{
  "mcpServers": {
    "compliance-checker": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-compliance-checker"
      ]
    }
  }
}
```

## Ferramentas MCP

`check_compliance`, `get_compliance_findings`, `analyze_privacy_policy`, `list_requirements`, `compare_frameworks`

Os detalhes de cada ferramenta estão em [README.md](README.md).

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
