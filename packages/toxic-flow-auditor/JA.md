# @guardbee/mcp-toxic-flow-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

MCP ツールカタログ全体で有害なデータフロー（lethal trifecta）を検出します：信頼できないコンテンツ、機密データ、外部送信や破壊的操作が同じサーバーにそろう組み合わせ。

## インストール

```bash
npx -y @guardbee/mcp-toxic-flow-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "toxic-flow-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-toxic-flow-auditor"
      ]
    }
  }
}
```

## MCP ツール

`audit_catalog`, `scan_source`, `scan_file`, `scan_directory`, `explain_trifecta`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-toxic-flow-auditor --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
