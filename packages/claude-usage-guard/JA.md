# @guardbee/mcp-claude-usage-guard

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

Claude プランの使用量がすべて自分のものかを確認します。Claude Code が /usage 用にキャッシュするアカウント全体のプランメーター（5時間 / 7日）を、このマシンのトランスクリプトと時系列で比較し、ローカルで説明できない使用を検出します。さらに、アカウントの切り替え、ログインを使う SDK/スクリプト、リモートログイン、バックグラウンドセッションも確認します。注意：claude.ai・デスクトップ・モバイルでの自分のチャットも同じ上限を消費します。

## インストール

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

## MCP ツール

`detect_foreign_usage`, `usage_report`, `account_status`, `plan_forecast`, `install_hooks`, `uninstall_hooks`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-claude-usage-guard detect
```

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
