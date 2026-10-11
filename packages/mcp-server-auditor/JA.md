# @guardbee/mcp-server-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

他の MCP サーバーのツール定義を監査し、危険なパターンを見つけます：過剰な権限を示すツール名、生の入力が流れ込むシェル/eval/SQL/SSRF、緩すぎるスキーマ、ハードコードされたシークレット、ワイルドカード CORS。

## インストール

```bash
npx -y @guardbee/mcp-server-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-server-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-server-auditor"
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
npx @guardbee/mcp-server-auditor --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
