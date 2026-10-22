# @guardbee/mcp-secret-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-secret-scanner.svg)](https://www.npmjs.com/package/@guardbee/mcp-secret-scanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

ファイル、ディレクトリ、git 履歴、コーディングエージェントの会話記録から、漏えいしたシークレット・API キー・認証情報を検出します（76 種のルール、エントロピー検出、ベースライン、CLI での有効性確認）。

## インストール

```bash
npx -y @guardbee/mcp-secret-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "secret-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-secret-scanner"
      ]
    }
  }
}
```

## MCP ツール

`scan_text`, `scan_file`, `scan_directory`, `scan_git`, `scan_agent_history`, `list_patterns`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-secret-scanner --help
```

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
