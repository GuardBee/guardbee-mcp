# @guardbee/mcp-security-engineer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

**GuardBee AI Security Engineer** の検出結果を、コーディングエージェント（Claude Code、Cursor、VS Code）で自分のリポジトリ上で修正し、本番サイトで修正を検証します。GuardBee が問題を見つけて説明し、プラットフォーム（Next.js、Express、Nginx、Apache、Cloudflare）向けの修正を提案します。変更はエージェントが行い、承認するのはあなたです。GuardBee がコードやサーバーを直接編集することはありません。`remediations.read` と `remediations.write` スコープを持つ API キー（GuardBee → Developers → API keys）が必要です。

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## インストール

```bash
claude mcp add guardbee-security-engineer -e GUARDBEE_API_KEY=gb_... -- npx -y @guardbee/mcp-security-engineer
```

## MCP ツール

`list_assessments`, `get_assessment`, `detect_stack`, `get_fix`, `report_applied`, `verify_fix`

詳細は [README.md](README.md) を参照してください。

## ライセンス

MIT

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
