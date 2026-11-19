# @guardbee/mcp-token-optimizer

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

このマシンで Claude Code のトークンを消費しているものを特定して止めます：肥大化したコンテキスト（各メッセージがコンテキスト全体を再送信します）、コンテキストを埋めるファイル読み込みや MCP ツール、未使用の MCP サーバー、アイドルセッション。

## インストール

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

## MCP ツール

`optimize_report`, `list_sessions`, `stop_sessions`, `audit_mcp_servers`, `disable_mcp_servers`, `restore_mcp_servers`, `measure_mcp_definitions`, `install_hooks`, `uninstall_hooks`

各ツールの詳細は [README.md](README.md) を参照してください。

`stop_sessions`・`disable_mcp_servers`・`restore_mcp_servers` はデフォルトでドライランです。停止するのは Claude Code CLI のみで、ツールを実行しているセッションは対象外です（`claude --resume` で再開可能）。設定を変更する前に必ずバックアップを取ります。

## CLI

```bash
npx @guardbee/mcp-token-optimizer report
```

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
