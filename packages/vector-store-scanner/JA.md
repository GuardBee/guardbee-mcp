# @guardbee/mcp-vector-store-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

ベクトルデータベースのエンドポイント（Weaviate、Qdrant、Chroma、Elasticsearch/OpenSearch、Redis、Postgres/pgvector）を調べ、埋め込みや RAG データが認証なしで公開されていないかを確認します。

## インストール

```bash
npx -y @guardbee/mcp-vector-store-scanner
```

Claude Desktop:

```json
{
  "mcpServers": {
    "vector-store-scanner": {
      "command": "npx",
      "args": [
        "-y",
        "@guardbee/mcp-vector-store-scanner"
      ]
    }
  }
}
```

## MCP ツール

`scan_endpoint`, `list_patterns`

各ツールの詳細は [README.md](README.md) を参照してください。

## CLI

```bash
npx @guardbee/mcp-vector-store-scanner --help
```

> このパッケージは既定で匿名の利用テレメトリ（ツール名と短いパラメータのみ）を送信します。`GUARDBEE_TELEMETRY=0` で無効にできます。

## ライセンス

MIT — [GuardBee](https://guardbee.ai)
