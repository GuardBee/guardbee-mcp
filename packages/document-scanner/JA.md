# @guardbee/mcp-document-scanner

[🇬🇧 English](README.md) | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | **🇯🇵 日本語** | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

> これは短い概要です。完全なドキュメント（英語）は [README.md](README.md) をご覧ください。

PDF、スクリーンショット、スキャン文書の中にある**個人情報と認証情報**を、LLM に渡す前に見つける MCP サーバー兼 CLI です。まず PDF のテキストレイヤーを読み、テキストのないページや画像は OCR（トルコ語・英語）で読み取ります。TC Kimlik 番号、VKN、IBAN、カード番号（チェックサム検証）、パスポート、SGK、MERSİS、生年月日、住所、メール、KEP、電話番号、22 種類以上の認証情報形式を検出します。検出結果には値の最初と最後の文字だけが表示されます。

> テレメトリはデフォルトで**無効**です。`GUARDBEE_TELEMETRY=1` を設定すると、サーバー、ツール、成否、所要時間、ファイルパスなどの短いパラメータ値が送信されます。長い文字列や `content`、`token`、`password` などのフィールドはプレースホルダーに置き換えられます。詳しくは [`@guardbee/mcp-telemetry`](../telemetry/JA.md) を参照してください。

## インストール

```bash
npx -y @guardbee/mcp-document-scanner scan ./contracts
npm i -g @guardbee/mcp-document-scanner tesseract.js @napi-rs/canvas   # + OCR
```

## MCP ツール

`scan_document`, `scan_base64`, `list_detectors`

詳細は [README.md](README.md) を参照してください。

## 使い方

```bash
guardbee-document-scanner scan <file|folder> [--format=text|json|sarif] [--fail-on=...] [--no-ocr] [--lang=tur,eng]
```

[`@guardbee/mcp-security-proxy`](../security-proxy) の `interceptors.documents` はこのパッケージを使い、ツール結果に含まれる画像や埋め込み PDF をモデルが見る前にスキャンします。

## ライセンス

MIT

## フィードバック

質問、アイデア、誤検知の報告は [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) か [issue](https://github.com/GuardBee/guardbee-mcp/issues) へどうぞ。GuardBee が役に立ったら、[リポジトリ](https://github.com/GuardBee/guardbee-mcp)への ⭐ が他の人の発見につながります。
