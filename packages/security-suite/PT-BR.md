# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Todas as ferramentas de segurança MCP da GuardBee em uma só instalação: um servidor MCP com as ferramentas dos pacotes que você escolher e uma CLI que executa qualquer pacote. 30 pacotes, 127 ferramentas MCP.

> A telemetria vem **desativada** por padrão. Com `GUARDBEE_TELEMETRY=1`, são enviados o servidor, a ferramenta, o sucesso, a duração e valores curtos de parâmetros, como um caminho de arquivo; textos mais longos e campos como `content`, `token` ou `password` são substituídos por um marcador. Veja [`@guardbee/mcp-telemetry`](../telemetry/PT-BR.md).

## Instalação

```bash
npm install -g @guardbee/security-suite
```

## Ferramentas MCP

`guardbee serve` oferece por padrão o grupo **recommended** (31 ferramentas): varredura OWASP MCP Top 10 de uma vez, segredos, prompt injection, fluxos tóxicos, configs de clientes MCP e CVEs de dependências. Escolha outros com `--tools=code,network` (grupos ou ids de pacotes) ou `--tools=all` (127 ferramentas). Os nomes das ferramentas levam o prefixo do pacote: `secrets_scan_text`, `injection_scan_text`. `guardbee list` mostra pacotes e grupos.

```json
{ "mcpServers": { "guardbee": { "command": "npx", "args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended"] } } }
```

## CLI

`guardbee <id-do-pacote> <args>` executa a CLI desse pacote, por exemplo `guardbee owasp-scan scan . --fail-on=high`.

## Licença

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Dúvidas, ideias ou um falso positivo? Abra um tópico no [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) ou [uma issue](https://github.com/GuardBee/guardbee-mcp/issues). Se o GuardBee for útil para você, uma ⭐ no [repositório](https://github.com/GuardBee/guardbee-mcp) ajuda outras pessoas a encontrá-lo.
