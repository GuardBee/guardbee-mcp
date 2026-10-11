# @guardbee/mcp-memory-poisoning-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

エージェントのコードでメモリ汚染のリスクを検出します：信頼できない入力が永続・セッション横断のメモリ（MemGPT 型のメモリや長期記憶としてのベクトルストア）に書き込まれ、後で信頼されたコンテキストとして呼び戻される箇所。

## インストール

```bash
npx -y @guardbee/mcp-memory-poisoning-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "memory-poisoning-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-memory-poisoning-scanner"
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
npx @guardbee/mcp-memory-poisoning-scanner --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
