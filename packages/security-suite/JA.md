# @guardbee/security-suite

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/security-suite.svg)](https://www.npmjs.com/package/@guardbee/security-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> これは短い要約です。完全なドキュメント（英語）は [README.md](README.md) にあります。

GuardBee の MCP セキュリティツールを 1 回のインストールですべて利用できます。選んだパッケージのツールを 1 つの MCP サーバーで提供し、CLI からは任意のパッケージを実行できます。30 パッケージ、127 の MCP ツール。

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## インストール

```bash
npm install -g @guardbee/security-suite
```

## MCP ツール

`guardbee serve` は既定で **recommended** グループ（31 ツール）を提供します：OWASP MCP Top 10 の一括スキャン、シークレット、プロンプトインジェクション、有害なデータフロー、MCP クライアント設定、依存関係の CVE。`--tools=code,network` でグループやパッケージ ID を、`--tools=all` で全ツール（127）を選べます。ツール名にはパッケージの接頭辞が付きます（例：`secrets_scan_text`、`injection_scan_text`）。`guardbee list` でパッケージとグループを一覧できます。

```json
{ "mcpServers": { "guardbee": { "command": "npx", "args": ["-y", "@guardbee/security-suite", "serve", "--tools=recommended"] } } }
```

## CLI

`guardbee <パッケージ ID> <引数>` でそのパッケージの CLI を実行します。例：`guardbee owasp-scan scan . --fail-on=high`。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
