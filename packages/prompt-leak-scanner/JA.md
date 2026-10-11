# @guardbee/mcp-prompt-leak-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

MCP サーバー兼リバースプロキシとして、LLM へ送られるプロンプトに含まれる認証情報や個人情報（API キー、TC Kimlik No、クレジットカード、IBAN）を、アプリケーションの外に出る前に捕捉します。

## インストール

```bash
npx -y @guardbee/mcp-prompt-leak-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "prompt-leak-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-prompt-leak-scanner"
      ]
    }
  }
}
```

## MCP ツール

`scan_text`, `scan_messages`, `scan_file`, `scan_directory`, `list_patterns`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-prompt-leak-scanner --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
