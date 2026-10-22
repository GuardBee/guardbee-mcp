# @guardbee/mcp-threat-rules

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

Agent Threat Rules（ATR）への GuardBee MCP ブリッジです。プロンプトインジェクション、ツールポイズニング、コンテキスト持ち出し、MCP 攻撃のためのオープンな Sigma 風検出標準でエージェント/MCP のイベントを評価します。

## インストール

```bash
npx -y @guardbee/mcp-threat-rules
```

Claude Desktop:

```json
{
  "mcpServers": {
    "threat-rules": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-threat-rules"
      ]
    }
  }
}
```

## MCP ツール

`evaluate_text`, `evaluate_file`, `evaluate_event`, `list_rules`, `rule_stats`, `explain_bridge`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-threat-rules --help
```

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
