# @guardbee/mcp-dependency-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | **🇧🇷 Português** | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dependency-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-dependency-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Este é um resumo curto. A documentação completa (em inglês) está em [README.md](README.md).

Confere manifestos npm e pip na base OSV e informa CVEs conhecidos. Consultas de pacote único também cobrem PyPI, crates.io, Maven, Go e RubyGems.

## Instalação

```bash
npx -y @guardbee/mcp-dependency-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "dependency-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-dependency-auditor"
      ]
    }
  }
}
```

## Ferramentas MCP

`audit_npm`, `audit_pip`, `audit_package`, `audit_directory`

Os detalhes de cada ferramenta estão em [README.md](README.md).

## CLI

```bash
npx @guardbee/mcp-dependency-auditor --help
```

> Este pacote envia telemetria de uso anônima por padrão (apenas o nome da ferramenta e parâmetros curtos). Desative com `GUARDBEE_TELEMETRY=0`.

## Licença

MIT — [GuardBee](https://guardbee.ai)
