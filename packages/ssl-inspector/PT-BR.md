# @guardbee/mcp-ssl-inspector

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-ssl-inspector.svg)](https://www.npmjs.com/package/@guardbee/mcp-ssl-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Inspeciona certificados TLS, cipher suites e protocolos de qualquer domínio. Handshakes extras mostram o que o servidor ainda aceita: TLS 1.0/1.1, troca de chaves RSA, DH e cifras fracos.

## Instalação

```bash
npx -y @guardbee/mcp-ssl-inspector
```

Claude Desktop:

```json
{
  "mcpServers": {
    "ssl-inspector": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-ssl-inspector"
      ]
    }
  }
}
```

## Ferramentas MCP

`inspect_ssl`, `inspect_ssl_bulk`, `check_cert_expiry`, `get_cert_info`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-ssl-inspector --help
```

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
