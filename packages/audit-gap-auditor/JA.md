# @guardbee/mcp-audit-gap-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

MCP サーバーのソースを OWASP MCP08:2025（監査とテレメトリの欠如）の観点で検査します：ツール呼び出しのログ欠如、ログ内の生の引数や結果、無効化された監査、記録されずに握りつぶされるエラー。

## インストール

```bash
npx -y @guardbee/mcp-audit-gap-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "audit-gap-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-audit-gap-auditor"
      ]
    }
  }
}
```

## MCP ツール

`scan_text`, `scan_file`, `scan_directory`, `list_patterns`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-audit-gap-auditor --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
