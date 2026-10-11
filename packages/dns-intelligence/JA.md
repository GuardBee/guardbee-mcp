# @guardbee/mcp-dns-intelligence

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-dns-intelligence.svg)](https://www.npmjs.com/package/@guardbee/mcp-dns-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

DNS レコードを列挙し、設定ミスやメールセキュリティ（SPF/DMARC）の不備、乗っ取り可能なダングリングサブドメインを検出します。

## インストール

```bash
npx -y @guardbee/mcp-dns-intelligence
```

Claude Desktop:

```json
{
  "mcpServers": {
    "dns-intelligence": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-dns-intelligence"
      ]
    }
  }
}
```

## MCP ツール

`enumerate_dns`, `enumerate_subdomains`, `check_email_security`, `lookup_dns`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-dns-intelligence --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
