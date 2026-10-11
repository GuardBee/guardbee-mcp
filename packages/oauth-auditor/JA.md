# @guardbee/mcp-oauth-auditor

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

MCP サーバー自身の認可コードを、MCP 仕様のセキュリティ考慮事項にある OAuth 2.1 の問題で検査します：トークンのパススルー、audience 検証の欠如、ディスカバリー経由の SSRF、PKCE の欠如、緩い redirect_uri 検証、ハードコードされたクライアントシークレット。

## インストール

```bash
npx -y @guardbee/mcp-oauth-auditor
```

Claude Desktop:

```json
{
  "mcpServers": {
    "oauth-auditor": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-oauth-auditor"
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
npx @guardbee/mcp-oauth-auditor --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
